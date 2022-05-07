import * as functions from "firebase-functions";
import { algolia, SearchOptions, RequestOptions } from "../../_algolia";
import { converter, db, location, runtime } from "../../_firebase";
import { dummy, log } from "../../_utils";
import { userAuthenticated } from "./_userAuthenticated";
import * as fetch from "./_fetch";
import * as Firestore from "../../types/firestore";
import * as Algolia from "../../types/algolia";

type Data = {
  index: "matters" | "resources";
  follows: string[];
  page?: number;
};

export const homePosts = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data, context) => {
    const status = await userAuthenticated({
      context,
      canceled: true,
    });

    const demo = checkDemo(context);

    const { posts, hit } = await fetchAlgolia(context, data, status);

    if (posts?.length)
      await fetchFiretore(context, data.index, posts, demo, status);

    await log({
      auth: { collection: "companys", doc: context.auth?.uid },
      run: "homePosts",
      index: data.index,
      code: 200,
      objectID: posts
        ?.map((post) => (post ? post.objectID : undefined))
        ?.filter((post): post is string => post !== undefined),
    });

    return { index: data.index, posts: posts, hit: hit };
  });

const fetchAlgolia = async (
  context: functions.https.CallableContext,
  data: Data,
  status: boolean
): Promise<{
  posts: Algolia.Matter[] | Algolia.Resource[];
  hit: Algolia.Hit;
}> => {
  const index = algolia.initIndex(data.index);
  const value = [context.auth?.uid, ...data.follows].join(" ");

  const hit: Algolia.Hit = {
    currentPage: data.page ? data.page : 0,
  };

  const options: (RequestOptions & SearchOptions) | undefined = {
    queryLanguages: ["ja", "en"],
    similarQuery: value,
    filters: "display:public",
    page: hit.currentPage,
  };

  const { hits, nbHits, nbPages } = await index
    .search<Algolia.Matter | Algolia.Resource>("", options)
    .catch(() => {
      throw new functions.https.HttpsError(
        "not-found",
        "投稿の取得に失敗しました",
        "algolia"
      );
    });

  hit.posts = nbHits;
  hit.pages = nbPages;

  const posts = (() => {
    switch (data.index) {
      case "matters":
        return hits
          .map((hit) => {
            if (hit.uid === context.auth?.uid)
              return fetch.auth.matter(<Algolia.Matter>hit);

            if (status) return fetch.other.matter(<Algolia.Matter>hit);

            return;
          })
          ?.filter((post): post is Algolia.Matter => post !== undefined);

      case "resources":
        return hits
          .map((hit) => {
            if (hit.uid === context.auth?.uid) {
              return fetch.auth.resource(<Algolia.Resource>hit);
            }

            if (status) return fetch.other.resource(<Algolia.Resource>hit);

            return;
          })
          ?.filter((post): post is Algolia.Resource => post !== undefined);

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

const fetchFiretore = async (
  context: functions.https.CallableContext,
  index: Data["index"],
  posts: (Algolia.Matter | undefined)[] | (Algolia.Resource | undefined)[],
  demo: boolean,
  status: boolean
): Promise<void> => {
  for (const [i, post] of posts.entries()) {
    if (!post) continue;

    const doc = await db
      .collection("companys")
      .withConverter(converter<Firestore.Company>())
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

      if (data?.type !== "individual" && data?.payment.status === "canceled") {
        posts[i] = undefined;
      } else {
        const { likes, outputs, entries } = await fetchActivity(
          context,
          index,
          post
        );

        post.user = {
          type: data?.type,
          profile: {
            name: !demo ? data?.profile.name : dummy.name(),
            person: !demo ? data?.profile.person : dummy.person(),
          },
        };

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
        post.likes = likes;
        post.outputs = outputs;
        post.entries = entries;
      }
    } else {
      posts[i] = undefined;
    }
  }
};

const fetchActivity = async (
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
    for (const collection of Object.keys(collections)) {
      const { docs } = await db
        .collectionGroup(collection)
        .withConverter(converter<Firestore.Post>())
        .where("index", "==", index)
        .where("objectID", "==", post.objectID)
        .where("active", "==", true)
        .orderBy("createAt", "desc")
        .get();

      collections[collection as keyof Collections] = docs.length;
    }

  return { ...collections };
};

const checkDemo = (context: functions.https.CallableContext): boolean => {
  return context.auth?.uid === functions.config().demo.ses_hub.uid;
};
