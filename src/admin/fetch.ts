import * as functions from "firebase-functions";
import { algolia } from "../_algolia";
import { converter, db, location, runtime } from "../_firebase";
import { userAuthenticated } from "./_userAuthenticated";
import * as fetch from "./_fetch";
import * as Firestore from "../types/firestore";
import * as Auth from "../types/auth";
import * as Algolia from "../types/algolia";

type Arg = {
  post: { index: "matters" | "persons"; objectID: string };

  posts: {
    index: "matters" | "resources" | "companys" | "persons";
    target: string | undefined;
    value: string | null;
    type: string | undefined;
    filter: string | undefined;
    page?: number;
  };

  user: { index: "companys" | "persons"; uid: string };
};

type Post = Algolia.Matter | Algolia.Resource;

type Posts =
  | Algolia.Matter
  | Algolia.Resource
  | Algolia.Company
  | Algolia.Person;

type Collections = {
  [key: string]: string[] | { [key: string]: string[] };
};

export const fetchPost = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (arg: Arg["post"], context) => {
    await userAuthenticated(context);
    const { post } = await fetchAlgolia.post(arg);

    return { index: arg.index, post };
  });

export const fetchPosts = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (arg: Arg["posts"], context) => {
    await userAuthenticated(context);

    if (arg.filter === "application") {
      const { posts } = await fetchApplication(arg);

      return { index: arg.index, posts: posts };
    } else {
      const { posts, hit } = await fetchAlgolia.posts(arg);

      posts.length && (await fetchFirestore.posts(arg, posts));

      return { index: arg.index, posts, hit };
    }
  });

export const fetchUser = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (arg: Arg["user"], context) => {
    await userAuthenticated(context);

    const user = await fetchFirestore.user(arg);

    if (!user) {
      throw new functions.https.HttpsError(
        "not-found",
        "ユーザーの取得に失敗しました",
        "firebase"
      );
    }

    return user;
  });

const fetchApplication = async (
  arg: Arg["posts"]
): Promise<{ posts: Auth.Company[] }> => {
  if (arg.index !== "companys") {
    throw new functions.https.HttpsError(
      "cancelled",
      "ユーザーのインデックスが無効です",
      "index"
    );
  }

  const collection = await db
    .collection(arg.index)
    .withConverter(converter<Firestore.Company>())
    .where("application", "==", true)
    .orderBy("lastLogin", "desc")
    .get();

  const posts = collection?.docs?.map((doc) => ({
    uid: doc.id,
    ...fetch.company.main(doc.data()),
  }));

  return { posts };
};

const fetchParent = async (uid?: string): Promise<Auth.Company | undefined> => {
  if (!uid) {
    return undefined;
  }

  const doc = await db
    .collection("companys")
    .withConverter(converter<Firestore.Company>())
    .doc(uid)
    .get();

  const data = doc.data();

  if (!doc.exists || !data) {
    throw new functions.https.HttpsError(
      "not-found",
      "ユーザーの取得に失敗しました",
      "firebase"
    );
  }

  const parent = fetch.company.main(data);

  return parent;
};

const fetchFirestore = {
  posts: async (
    arg: Arg["posts"],
    posts?: (Algolia.Matter | Algolia.Resource | Auth.Company | Auth.Person)[]
  ): Promise<void> => {
    if (!posts?.length) return;

    await Promise.allSettled(
      posts.map(async (_, i) => {
        const index = arg.index !== "persons" ? "companys" : "persons";
        const post = posts[i];
        const uid = post.uid;

        if (!uid) {
          if ("objectID" in post) {
            post.user = fetch.company.none();
          }

          return;
        }

        const doc = await db
          .collection(index)
          .withConverter(converter<Firestore.Company | Firestore.Person>())
          .doc(uid)
          .get()
          .catch(() => {
            throw new functions.https.HttpsError(
              "not-found",
              "ユーザーの取得に失敗しました",
              "firebase"
            );
          });

        const data = doc.data();

        if (!doc.exists || !data) return;

        if (
          (arg.index === "matters" || arg.index === "resources") &&
          "objectID" in post
        ) {
          post.user = fetch.company.itemSupplementary(<Firestore.Company>data);
        }

        if (arg.index === "companys") {
          const collections = await fetchCollections({
            index: arg.index,
            uid: doc.id,
          });

          fetch.company.supplementary(
            <Auth.Company>post,
            <Firestore.Company>data
          );

          Object.assign(post, collections);
        }

        if (arg.index === "persons") {
          const collections = await fetchCollections({
            index: arg.index,
            uid: doc.id,
          });

          fetch.person.supplementary(<Auth.Person>post, <Firestore.Person>data);

          Object.assign(post, collections);
        }
      })
    );
  },

  user: async (
    arg: Arg["user"]
  ): Promise<Auth.Company | Auth.Person | void> => {
    const doc = await db
      .collection(arg.index)
      .withConverter(converter<Firestore.Company | Firestore.Person>())
      .doc(arg.uid)
      .get()
      .catch(() => {
        throw new functions.https.HttpsError(
          "not-found",
          "ユーザーの取得に失敗しました",
          "firebase"
        );
      });

    const data = doc.data();

    if (!doc.exists || !data) {
      throw new functions.https.HttpsError(
        "not-found",
        "ユーザーの取得に失敗しました",
        "firebase"
      );
    }

    const collections = await fetchCollections({
      index: arg.index,
      uid: doc.id,
    });

    if ("payment" in data) {
      const parent =
        data.type === "child"
          ? await fetchParent(data.payment.parent)
          : undefined;

      const user: Auth.Company = !parent
        ? { uid: doc.id, ...fetch.company.main(data), ...collections }
        : {
            uid: doc.id,
            parent: parent,
            ...fetch.company.main(data),
            ...collections,
          };

      return user;
    }

    if ("resume" in data) {
      const user: Auth.Person = {
        uid: doc.id,
        ...fetch.person.main(data),
        ...collections,
      };

      return user;
    }

    return;
  },
};

const fetchCollections = async ({
  index,
  uid,
}: {
  index: "companys" | "persons";
  uid: string;
}): Promise<Collections> => {
  const collections: Collections =
    index === "companys"
      ? {
          posts: { matters: [], resources: [] },
          follows: [],
          home: [],
          likes: { matters: [], resources: [], persons: [] },
          outputs: { matters: [], resources: [] },
          entries: { matters: [], resources: [], persons: [] },
        }
      : {
          follows: [],
          home: [],
          likes: [],
          entries: [],
          histories: [],
          requests: { enable: [], hold: [], disable: [] },
        };

  await Promise.allSettled(
    Object.keys(collections).map(async (key) => {
      const querySnapshot = await db
        .collection(index)
        .doc(uid)
        .collection(key === "home" ? "follows" : key)
        .where("active", "==", true)
        .orderBy("updateAt", "desc")
        .withConverter(converter<Firestore.Post | Firestore.User>())
        .get()
        .catch(() => {});

      if (!querySnapshot) return;

      querySnapshot.forEach((doc) => {
        const collection = collections[key];
        const data = doc.data();

        if (collection instanceof Array) {
          if ("objectID" in data) {
            const objectID = data.objectID;

            Object.assign(collections, {
              [key]: [...collection, objectID],
            });
          } else {
            const uid = data.uid;

            if ("home" in data) {
              const home = data.home;

              if (home) {
                Object.assign(collections, {
                  [key]: [...collection, uid],
                });
              }
            } else {
              Object.assign(collections, {
                [key]: [...collection, uid],
              });
            }
          }
        } else {
          if (key !== "requests") {
            const index = data.index;

            if ("objectID" in data) {
              const objectID = data.objectID;

              Object.assign(collections[key], {
                [index]: [...collection[index], objectID],
              });
            } else {
              const uid = data.uid;

              Object.assign(collections[key], {
                [index]: [...collection[index], uid],
              });
            }
          } else if ("status" in data) {
            const status = data.status;
            const uid = data.uid;

            if (status) {
              Object.assign(collections[key], {
                [status]: [...collection[status], uid],
              });
            }
          }
        }
      });
    })
  );

  return collections;
};

const fetchAlgolia = {
  post: async (
    arg: Arg["post"]
  ): Promise<{ post: Algolia.Matter | Algolia.Resource }> => {
    const index = algolia.initIndex(arg.index);

    const hit = await index.getObject<Post>(arg.objectID).catch(() => {
      throw new functions.https.HttpsError(
        "not-found",
        "投稿の取得に失敗しました",
        "notFound"
      );
    });

    const post =
      arg.index === "matters"
        ? fetch.matter(<Algolia.Matter>hit)
        : fetch.resource(<Algolia.Resource>hit);

    return { post };
  },

  posts: async (
    arg: Arg["posts"]
  ): Promise<{
    posts: (Algolia.Matter | Algolia.Resource | Auth.Company | Auth.Person)[];

    hit: Algolia.Hit;
  }> => {
    const index = algolia.initIndex(
      !arg.target ||
        ((arg.index === "matters" || arg.index === "resources") &&
          arg.target === "createAt") ||
        ((arg.index === "companys" || arg.index === "persons") &&
          arg.target === "lastLogin")
        ? arg.index
        : `${arg.index}_${arg.target}_${arg.type}`
    );

    const hit: Algolia.Hit = {
      currentPage: arg.page ? arg.page : 0,
    };

    const result = await index
      .search<Posts>(arg.value ? arg.value : "", {
        page: hit.currentPage,
        filters: arg.filter === "all" ? "" : arg.filter,
      })
      .catch(() => {
        throw new functions.https.HttpsError(
          "not-found",
          "投稿の取得に失敗しました",
          "algolia"
        );
      });

    hit.posts = result?.nbHits;
    hit.pages = result?.nbPages;

    const posts = result?.hits
      ?.map((hit) =>
        arg.index === "matters"
          ? fetch.matter(<Algolia.Matter>hit)
          : arg.index === "resources"
          ? fetch.resource(<Algolia.Resource>hit)
          : arg.index === "companys"
          ? fetch.company.item(<Algolia.Company>hit)
          : arg.index === "persons" && fetch.person.item(<Algolia.Person>hit)
      )
      ?.filter((post) => post) as (
      | Algolia.Matter
      | Algolia.Resource
      | Auth.Company
      | Auth.Person
    )[];

    return { posts, hit };
  },
};
