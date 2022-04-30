import * as functions from "firebase-functions";
import { converter, db, location, runtime } from "../../_firebase";
import { algolia, SearchOptions, RequestOptions } from "../../_algolia";
import { dummy, log } from "../../_utils";
import { userAuthenticated } from "./_userAuthenticated";
import * as fetch from "./_fetch";
import * as Firestore from "../../types/firestore";
import * as Algolia from "../../types/algolia";

type Data = {
  index: "companys" | "persons";
  uid?: string;
  uids?: string[];
};

export const fetchUser = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    const status = await userAuthenticated({
      context,
      index: data.index,
      canceled: true,
      fetch: true,
    });

    const user = await fetchProfile(context, data, status);
    const bests =
      data.index === "persons" &&
      "request" in user &&
      (await fetchBests(context, user, data));

    if (user && "uid" in user) await addHistory(context, data);

    await log({
      doc: context.auth?.uid,
      run: "fetchUser",
      index: data.index,
      code: 200,
      uid: data.uid || data.uids,
    });

    return { user: user, bests: bests };
  });

const fetchProfile = async (
  context: functions.https.CallableContext,
  data: Data,
  status: boolean
): Promise<
  Algolia.CompanyItem | Algolia.PersonItem | Algolia.CompanyItem[]
> => {
  const demo = checkDemo(context);

  const user = await fetchAlgolia(data, demo, status);

  if (!user)
    throw new functions.https.HttpsError(
      "not-found",
      "ユーザーの取得に失敗しました",
      "notFound"
    );

  if (user) await fetchFirestore(context, status, data, user);

  return user;
};

const fetchAlgolia = async (
  data: Data,
  demo: boolean,
  status: boolean
): Promise<
  Algolia.CompanyItem | Algolia.PersonItem | Algolia.CompanyItem[] | undefined
> => {
  const index = algolia.initIndex(data.index);

  if (data.uid) {
    const hit = await index
      .getObject<Algolia.Company | Algolia.Person>(data.uid)
      .catch(() => {
        throw new functions.https.HttpsError(
          "not-found",
          "プロフィールの取得に失敗しました",
          "notFound"
        );
      });

    const user = (() => {
      switch (data.index) {
        case "companys": {
          if (hit)
            if (status) {
              return fetch.company.active(<Algolia.Company>hit, demo);
            } else {
              return fetch.company.canceled(<Algolia.Company>hit, demo);
            }

          return;
        }
        case "persons": {
          if (hit) return fetch.person(<Algolia.Person>hit, demo);

          return;
        }
        default:
          throw new functions.https.HttpsError(
            "not-found",
            "プロフィールの取得に失敗しました",
            "notFound"
          );
      }
    })();

    if (!user) {
      throw new functions.https.HttpsError(
        "not-found",
        "プロフィールの取得に失敗しました",
        "notFound"
      );
    }

    return user;
  }

  if (data.uids) {
    const { results } = await index
      .getObjects<Algolia.Company>(data.uids)

      .catch(() => {
        throw new functions.https.HttpsError(
          "not-found",
          "プロフィールの取得に失敗しました",
          "notFound"
        );
      });

    const user = results
      .map((hit) => {
        if (hit) return fetch.company.active(hit);

        return;
      })
      ?.filter((post): post is Algolia.CompanyItem => post !== undefined);

    return user;
  }

  return;
};

const fetchFirestore = async (
  context: functions.https.CallableContext,
  status: boolean,
  data: Data,
  user: Algolia.CompanyItem | Algolia.PersonItem | Algolia.CompanyItem[]
): Promise<void> => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証されていないユーザーではログインできません",
      "auth"
    );
  }

  if (data.uid && "uid" in user) {
    const doc = await db
      .collection(data.index)
      .withConverter(converter<Firestore.Company | Firestore.Person>())
      .doc(data.uid)
      .get()
      .catch(() => {
        throw new functions.https.HttpsError(
          "not-found",
          "ユーザーの取得に失敗しました",
          "notFound"
        );
      });

    if (doc.exists) {
      if (data.index === "companys") {
        if (!("type" in user)) return;
        const data = doc.data() as Firestore.Company;

        user.icon = data?.icon;
        user.cover = data?.cover;

        if (data.type !== "individual" && data.payment.status === "canceled") {
          throw new functions.https.HttpsError(
            "not-found",
            "ユーザーの取得に失敗しました",
            "notFound"
          );
        }

        const { follows, followers, followed } = await fetchActivity.companys(
          context,
          user
        );

        if (!status) {
          user.profile.email = undefined;
        }

        user.status = data?.payment.status;
        user.type = data?.type;
        user.follows = follows;
        user.followers = followers;
        user.followed = followed;
      }

      if (data.index === "persons") {
        if (!("request" in user)) return;
        const data = doc.data() as Firestore.Person;

        user.icon = data?.icon;
        user.cover = data?.cover;

        const { likes, requests } = await fetchActivity.persons(context, user);

        if (requests !== "enable") {
          user.profile.name = dummy.person();
          user.profile.email = dummy.email();
          user.profile.urls = dummy.urls(3);

          user.resume = undefined;
        } else {
          user.resume = data.resume.url || undefined;
        }

        user.request = requests;
        user.likes = likes;
      }
    }
  }

  if (data.uids && user instanceof Array) {
    for (const child of user) {
      if (!child) continue;

      const doc = await db
        .collection(data.index)
        .withConverter(converter<Firestore.Company>())
        .doc(child.uid)
        .get()
        .catch(() => {
          throw new functions.https.HttpsError(
            "not-found",
            "ユーザーの取得に失敗しました",
            "firebase"
          );
        });

      if (doc.exists) {
        const data = doc.data();

        child.icon = data?.icon;
        child.cover = data?.cover;
        child.type = data?.type;
      }
    }
  }
};

const fetchBests = async (
  context: functions.https.CallableContext,
  user: Algolia.PersonItem,
  data: Data
): Promise<(Algolia.PersonItem | undefined)[]> => {
  const index = algolia.initIndex("persons");

  const options: (RequestOptions & SearchOptions) | undefined = {
    queryLanguages: ["ja", "en"],
    similarQuery: user.profile.handles?.join(" "),
    filters: "status:enable",
    hitsPerPage: 100,
  };

  const { hits } = await index.search<Algolia.Person>("", options).catch(() => {
    throw new functions.https.HttpsError(
      "not-found",
      "投稿の取得に失敗しました",
      "algolia"
    );
  });

  const posts = hits?.map((hit) =>
    hit.objectID !== user.uid ? fetch.best(hit) : undefined
  );

  for (const [i, post] of posts.entries()) {
    if (!post) continue;

    const doc = await db
      .collection(data.index)
      .withConverter(converter<Firestore.Person>())
      .doc(post.uid)
      .get()
      .catch(() => {
        throw new functions.https.HttpsError(
          "not-found",
          "ユーザーの取得に失敗しました",
          "firebase"
        );
      });

    if (doc.exists) {
      const data = doc.data();

      if (data?.profile.nickName) {
        const { likes, requests } = await fetchActivity.persons(context, post);

        post.icon = data?.icon;
        post.request = requests;
        post.likes = likes;
      } else {
        posts[i] = undefined;
      }
    }
  }

  return posts;
};

const fetchActivity = {
  companys: async (
    context: functions.https.CallableContext,
    post: Algolia.CompanyItem
  ): Promise<{ follows: number; followers: number; followed: boolean }> => {
    const demo = checkDemo(context);

    type Collections = {
      follows: number;
      followers: number;
      followed: boolean;
    };

    const collections: Collections = {
      follows: !demo ? 0 : dummy.num(99, 999),
      followers: !demo ? 0 : dummy.num(99, 999),
      followed: false,
    };

    if (!demo)
      for (const collection of Object.keys(collections)) {
        switch (collection) {
          case "follows": {
            const { docs } = await db
              .collection("companys")
              .doc(post.uid)
              .collection("follows")
              .withConverter(converter<Firestore.User>())
              .where("active", "==", true)
              .orderBy("updateAt", "desc")
              .get();

            collections.follows = docs.length;

            docs.forEach((doc) => {
              if (doc.id === context.auth?.uid) collections.followed = true;
            });
          }
          case "followers": {
            const { docs } = await db
              .collectionGroup("follows")
              .withConverter(converter<Firestore.User>())
              .where("uid", "==", post.uid)
              .where("active", "==", true)
              .orderBy("updateAt", "desc")
              .get();

            collections.followers = docs.length;
          }
          default:
            continue;
        }
      }

    return { ...collections };
  },
  persons: async (
    context: functions.https.CallableContext,
    post: Algolia.PersonItem
  ): Promise<{ likes: number; requests: string }> => {
    const demo = checkDemo(context);

    const collections = {
      likes: !demo ? 0 : dummy.num(99, 999),
      requests: "none",
    };

    if (!demo)
      for (const collection of Object.keys(collections)) {
        if (collection === "likes") {
          const { docs } = await db
            .collectionGroup(collection)
            .withConverter(converter<Firestore.Post>())
            .where("index", "==", "persons")
            .where("uid", "==", post.uid)
            .where("active", "==", true)
            .orderBy("createAt", "desc")
            .get();

          collections.likes = docs.length;
        } else {
          const { docs } = await db
            .collection("persons")
            .withConverter(converter<Firestore.User>())
            .doc(post.uid)
            .collection(collection)
            .withConverter(converter<Firestore.User>())
            .where("uid", "==", context.auth?.uid)
            .get();

          const status = docs.length && docs[0].data().status;

          collections.requests =
            status === "enable" ? "enable" : status ? "hold" : "none";
        }
      }

    return { ...collections };
  },
};

const addHistory = async (
  context: functions.https.CallableContext,
  data: Data
): Promise<void> => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証されていないユーザーではログインできません",
      "auth"
    );
  }

  if (context.auth.uid === data.uid) {
    return;
  }

  if (!data.uid) {
    return;
  }

  const timestamp = Date.now();

  const collection = db
    .collection("companys")
    .doc(context.auth.uid)
    .collection("histories")
    .withConverter(converter<Firestore.User>());

  const querySnapshot = await collection
    .where("index", "==", data.index)
    .where("uid", "==", data.uid)
    .orderBy("createAt", "desc")
    .get()
    .catch(() => {});

  if (querySnapshot) {
    const doc = querySnapshot.docs[0];
    const lastHistory = doc?.data()?.createAt;

    if (lastHistory && lastHistory + 60 * 3 * 1000 > timestamp) {
      return;
    }
  }

  await collection
    .add({
      index: data.index,
      uid: data.uid,
      active: true,
      createAt: timestamp,
      updateAt: timestamp,
    })
    .catch(() => {
      throw new functions.https.HttpsError(
        "data-loss",
        "データの追加に失敗しました",
        "firebase"
      );
    });

  return;
};

const checkDemo = (context: functions.https.CallableContext) =>
  context.auth?.uid === functions.config().demo.ses_hub.uid;
