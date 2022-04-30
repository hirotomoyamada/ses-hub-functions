import * as functions from "firebase-functions";
import { algolia, SearchOptions, RequestOptions } from "../../_algolia";
import { converter, db, location, runtime } from "../../_firebase";
import { userAuthenticated } from "./_userAuthenticated";
import * as fetch from "./_fetch";
import * as Firestore from "../../types/firestore";
import * as Algolia from "../../types/algolia";
import { dummy, log } from "../../_utils";

type Data = {
  index: "matters" | "resources" | "companys";
  uid: string;
  uids?: string[];
  display?: string | null;
  status?: string | null;
  page?: number;
};

export const userPosts = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await userAuthenticated({ context });

    const demo = checkDemo(context);

    const { posts, hit } = !data.uids
      ? await fetchPosts(context, data)
      : await fetchFollows(data, demo);

    if (posts.length) await fetchFirestore(context, data.index, posts);

    await log({
      doc: context.auth?.uid,
      run: "userPosts",
      index: data.index,
      code: 200,
      objectID: posts
        ?.map((post) =>
          post ? ("objectID" in post && post.objectID) || post.uid : undefined
        )
        ?.filter((post): post is string => post !== undefined),
    });

    return { index: data.index, posts: posts, hit: hit };
  });

const fetchPosts = async (
  context: functions.https.CallableContext,
  data: Data
): Promise<{
  posts: Algolia.Matter[] | Algolia.Resource[];
  hit: Algolia.Hit;
}> => {
  const index = algolia.initIndex(data.index);

  const hit: Algolia.Hit = {
    currentPage: data.page ? data.page : 0,
  };

  const options: (RequestOptions & SearchOptions) | undefined = {
    filters:
      data.uid !== context.auth?.uid
        ? "display:public"
        : data.display && data.status
        ? `display:${data.display} AND status:${data.status}`
        : data.display
        ? `display:${data.display}`
        : data.status
        ? `status:${data.status}`
        : "",
    page: hit.currentPage,
  };

  const { hits, nbHits, nbPages } = await index
    .search<Algolia.Matter | Algolia.Resource>(data.uid, options)
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
        return hits.map((hit) => {
          if (hit.uid === context.auth?.uid) {
            return fetch.auth.matter(<Algolia.Matter>hit);
          } else {
            return fetch.other.matter(<Algolia.Matter>hit);
          }
        });

      case "resources":
        return hits.map((hit) => {
          if (hit.uid === context.auth?.uid) {
            return fetch.auth.resource(<Algolia.Resource>hit);
          } else {
            return fetch.other.resource(<Algolia.Resource>hit);
          }
        });

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

const fetchFollows = async (
  data: Data,
  demo: boolean
): Promise<{
  posts: Algolia.CompanyItem[];
  hit: Algolia.Hit;
}> => {
  const index = algolia.initIndex(data.index);

  const hitsPerPage = 50;

  const hit: Algolia.Hit = {
    posts: data.uids?.length,
    pages: data.uids?.length && Math.ceil(data.uids.length / 50),
    currentPage: data.page ? data.page : 0,
  };

  const query = data.uids?.length
    ? data.uids.slice(
        hit.currentPage * hitsPerPage,
        hitsPerPage * (hit.currentPage + 1)
      )
    : [];

  const { results } = await index
    .getObjects<Algolia.Company>(query)
    .catch(() => {
      throw new functions.https.HttpsError(
        "not-found",
        "投稿の取得に失敗しました",
        "algolia"
      );
    });

  const posts = results
    ?.map((hit) => {
      if (hit && hit.status === "enable") return fetch.other.company(hit, demo);

      return;
    })
    ?.filter((post): post is Algolia.CompanyItem => post !== undefined);

  return { posts, hit };
};

const fetchFirestore = async (
  context: functions.https.CallableContext,
  index: Data["index"],
  posts: Algolia.Matter[] | Algolia.Resource[] | Algolia.CompanyItem[]
): Promise<void> => {
  for (const post of posts) {
    if (!post) continue;

    if ("objectID" in post) {
      if (index === "companys") return;

      const { likes, outputs, entries } = await fetchActivity(
        context,
        index,
        post
      );

      post.likes = likes;
      post.outputs = outputs;
      post.entries = entries;
    } else {
      const doc = await db
        .collection(index)
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
        if (
          data?.type !== "individual" &&
          data?.payment.status === "canceled"
        ) {
          post.icon = "none";
          post.status = "none";
          post.type = "none";
          post.profile = {
            name: undefined,
            person: "存在しないユーザー",
            body: undefined,
          };
        } else {
          post.icon = data?.icon;
          post.type = data?.type;
        }
      }
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

const checkDemo = (context: functions.https.CallableContext): boolean =>
  context.auth?.uid === functions.config().demo.ses_hub.uid;
