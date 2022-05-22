import * as functions from "firebase-functions";
import { algolia } from "../../_algolia";
import { converter, db, location, runtime } from "../../_firebase";
import { userAuthenticated } from "./_userAuthenticated";
import * as fetch from "./_fetch";
import * as Algolia from "../../types/algolia";
import * as Firestore from "../../types/firestore";
import { dummy, log } from "../../_utils";

type Data = {
  index: "matters" | "resources" | "persons";
  type: "likes" | "outputs" | "entries";
  objectIDs: string[];
  page?: number;
};

export const extractPosts = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    const status = await userAuthenticated({
      context,
      index: data.index,
      type: data.type,
      canceled: true,
    });

    const { posts, hit } = await fetchAlgolia(context, data, status);

    if (posts?.length) await fetchFirestore(context, data, posts, status);

    await log({
      auth: { collection: "companys", doc: context.auth?.uid },
      run: "extractPosts",
      index: data.index,
      code: 200,
      objectID: posts
        ?.map((post) =>
          post ? ("objectID" in post && post.objectID) || post.uid : undefined
        )
        ?.filter((post): post is string => post !== undefined),
    });

    return {
      index: data.index,
      kind: data.type,
      posts: (posts as any[]).filter((post) => post !== undefined),
      hit: hit,
    };
  });

const fetchAlgolia = async (
  context: functions.https.CallableContext,
  data: Data,
  status: boolean
): Promise<{
  posts: Algolia.Matter[] | Algolia.Resource[] | Algolia.PersonItem[];
  hit: Algolia.Hit;
}> => {
  const index = algolia.initIndex(data.index);

  const objectIDs = data.objectIDs;

  const hitsPerPage = 50;

  const hit: Algolia.Hit = {
    posts: objectIDs.length,
    pages: Math.ceil(objectIDs.length / 50),
    currentPage: data.page ? data.page : 0,
  };

  const query = objectIDs.slice(
    hit.currentPage * hitsPerPage,
    hitsPerPage * (hit.currentPage + 1)
  );

  const { results } = await index
    .getObjects<Algolia.Matter | Algolia.Resource | Algolia.Person>(query)
    .catch(() => {
      throw new functions.https.HttpsError(
        "not-found",
        "投稿の取得に失敗しました",
        "algolia"
      );
    });

  const posts = (() => {
    switch (data.index) {
      case "matters":
        return results
          .map((hit) => {
            if (hit) {
              if (hit.uid === context.auth?.uid)
                return fetch.auth.matter(<Algolia.Matter>hit);

              if ((hit as Algolia.Matter).display === "public")
                return fetch.other.matter(<Algolia.Matter>hit);
            }

            return;
          })
          ?.filter((post): post is Algolia.Matter => post !== undefined);

      case "resources":
        return results
          .map((hit) => {
            if (hit) {
              if (hit.uid === context.auth?.uid)
                return fetch.auth.resource(<Algolia.Resource>hit);

              if ((hit as Algolia.Resource).display === "public")
                return fetch.other.resource(<Algolia.Resource>hit);
            }

            return;
          })
          ?.filter((post): post is Algolia.Resource => post !== undefined);

      case "persons":
        return results
          .map((hit) => {
            if (hit)
              if (
                (hit as Algolia.Person).nickName &&
                hit.status === "enable" &&
                status
              )
                return fetch.other.person(<Algolia.Person>hit);

            return;
          })
          ?.filter((post): post is Algolia.PersonItem => post !== undefined);

      default:
        throw new functions.https.HttpsError(
          "not-found",
          "投稿の取得に失敗しました",
          "algolia"
        );
    }
  })();

  return { posts, hit };
};

const fetchFirestore = async (
  context: functions.https.CallableContext,
  data: Data,
  posts:
    | (Algolia.Matter | undefined)[]
    | (Algolia.Resource | undefined)[]
    | Algolia.PersonItem[],
  status: boolean
): Promise<void> => {
  const { index, type } = data;

  const demo = checkDemo(context);

  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証されていないユーザーではログインできません",
      "auth"
    );
  }

  const { uid } = context.auth;

  await Promise.allSettled(
    posts.map(async (_, i) => {
      const post = posts[i];

      if (!status && type !== "entries" && post?.uid !== uid) {
        posts[i] = undefined;

        return;
      }

      if (!post) return;

      const doc = await db
        .collection(
          index === "matters" || index === "resources" ? "companys" : index
        )
        .withConverter(converter<Firestore.Company | Firestore.Person>())
        .doc(post.uid)
        .get()
        .catch(() => {
          throw new functions.https.HttpsError(
            "not-found",
            "ユーザーの取得に失敗しました",
            "firebase"
          );
        });

      if (!doc.exists) return;
      switch (index) {
        case "matters":
        case "resources":
          {
            if (!("objectID" in post)) return;
            const data = doc.data() as Firestore.Company;

            if (
              data.type !== "individual" &&
              data.payment.status === "canceled"
            ) {
              posts[i] = undefined;
            } else {
              post.user = {
                uid: doc.id,
                icon: data?.icon,
                type: data?.type,
                status: data?.payment.status,
                profile: {
                  name: !demo ? data?.profile.name : dummy.name(),
                  person: !demo
                    ? data?.profile.person
                      ? data?.profile.person
                      : "名無しさん"
                    : dummy.person(),
                  body: data?.profile.body,
                  email: !demo ? data?.profile.email : undefined,
                  social: !demo && status ? data?.profile.social : undefined,
                },
              };

              if (status) {
                const { likes, outputs, entries } = await fetchActivity.post(
                  context,
                  index,
                  post
                );

                post.likes = likes;
                post.outputs = outputs;
                post.entries = entries;
              }
            }
          }
          break;

        case "persons":
          {
            if (!("request" in post)) return;
            const data = doc.data() as Firestore.Person;

            const { likes, requests } = await fetchActivity.user(
              context,
              index,
              post
            );

            post.icon = data.icon;
            post.request = requests;
            post.likes = likes;
          }
          break;

        default:
          return;
      }
    })
  );
};

const fetchActivity = {
  post: async (
    context: functions.https.CallableContext,
    index: "matters" | "resources",
    post: Algolia.Matter | Algolia.Resource
  ): Promise<{ likes: number; outputs: number; entries: number }> => {
    const demo = checkDemo(context);

    type Collections = { likes: number; outputs: number; entries: number };

    const collections: Collections = {
      likes: !demo ? 0 : dummy.num(99, 999),
      outputs: !demo ? 0 : dummy.num(99, 999),
      entries: !demo ? 0 : dummy.num(99, 999),
    };

    if (!demo)
      await Promise.allSettled(
        Object.keys(collections).map(async (collection) => {
          const { docs } = await db
            .collectionGroup(collection)
            .withConverter(converter<Firestore.Post>())
            .where("index", "==", index)
            .where("objectID", "==", post.objectID)
            .where("active", "==", true)
            .orderBy("createAt", "desc")
            .get();

          collections[collection as keyof Collections] = docs.length;
        })
      );

    return { ...collections };
  },

  user: async (
    context: functions.https.CallableContext,
    index: "persons",
    post: Algolia.PersonItem
  ): Promise<{ likes: number; requests: string }> => {
    const demo = checkDemo(context);

    const collections = {
      likes: !demo ? 0 : dummy.num(99, 999),
      requests: "none",
    };

    if (!demo)
      await Promise.allSettled(
        Object.keys(collections).map(async (collection) => {
          if (collection === "likes") {
            const { docs } = await db
              .collectionGroup(collection)
              .withConverter(converter<Firestore.Post>())
              .where("index", "==", index)
              .where("uid", "==", post.uid)
              .where("active", "==", true)
              .orderBy("createAt", "desc")
              .get();

            collections.likes = docs.length;
          } else {
            const { docs } = await db
              .collection(index)
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
        })
      );

    return { ...collections };
  },
};

const checkDemo = (context: functions.https.CallableContext): boolean =>
  context.auth?.uid === functions.config().demo.ses_hub.uid;
