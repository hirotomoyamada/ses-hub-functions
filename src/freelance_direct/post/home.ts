import * as functions from "firebase-functions";
import { algolia, SearchOptions, RequestOptions } from "../../_algolia";
import { converter, db, location, runtime } from "../../_firebase";
import { userAuthenticated } from "./_userAuthenticated";
import * as fetch from "./_fetch";
import * as Algolia from "../../types/algolia";
import * as Firestore from "../../types/firestore";
import { dummy, log } from "../../_utils";

type Data = { index: "matters" | "companys"; follows: string[]; page?: number };

type Posts = Algolia.Matter | Algolia.CompanyItem;

export const homePosts = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await userAuthenticated(context);
    const demo = checkDemo(context);

    const { posts, hit } = await fetchAlgolia(context, data, demo);

    posts.length && (await fetchFirestore(context, data.index, posts));

    await log({
      auth: { collection: "persons", doc: context.auth?.uid },
      run: "fetchPosts",
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

const fetchAlgolia = async (
  context: functions.https.CallableContext,
  data: Data,
  demo: boolean
): Promise<{
  posts: Posts[];
  hit: Algolia.Hit;
}> => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証されていないユーザーではログインできません",
      "auth"
    );
  }

  const index = algolia.initIndex(data.index);
  const value =
    data.index === "matters"
      ? [context.auth.uid, ...data.follows].join(" ")
      : undefined;

  const hitsPerPage = 50;

  const hit: Algolia.Hit =
    data.index === "matters"
      ? {
          currentPage: data.page ? data.page : 0,
        }
      : {
          posts: data.follows.length,
          pages: Math.ceil(data.follows.length / 50),
          currentPage: data.page ? data.page : 0,
        };

  const options: (RequestOptions & SearchOptions) | undefined = {
    queryLanguages: ["ja", "en"],
    similarQuery: value,
    filters: "display:public",
    page: hit.currentPage,
  };

  if (data.index === "matters") {
    const results = await index
      .search<Algolia.Matter>("", options)
      .catch(() => {
        throw new functions.https.HttpsError(
          "not-found",
          "投稿の取得に失敗しました",
          "algolia"
        );
      });

    hit.posts = results?.nbHits;
    hit.pages = results?.nbPages;

    const posts = results?.hits
      .map((hit) => hit && fetch.matter(hit))
      ?.filter((post) => post);

    return { posts, hit };
  } else {
    const { results } = await index
      .getObjects<Algolia.Company>(
        data.follows.slice(
          hit.currentPage * hitsPerPage,
          hitsPerPage * (hit.currentPage + 1)
        )
      )
      .catch(() => {
        throw new functions.https.HttpsError(
          "not-found",
          "投稿の取得に失敗しました",
          "algolia"
        );
      });

    const posts = results
      ?.map((hit) => hit?.status === "enable" && fetch.company.item(hit, demo))
      ?.filter((post) => post) as Algolia.CompanyItem[];

    return { posts, hit };
  }
};

const fetchFirestore = async (
  context: functions.https.CallableContext,
  index: Data["index"],
  posts: Posts[]
): Promise<void> => {
  const demo = checkDemo(context);

  for (const post of posts) {
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

      switch (index) {
        case "matters": {
          if (!("objectID" in post)) return;

          const { likes } = await fetchActivity(context, index, post);

          post.likes = likes;

          if (
            data?.payment.status === "canceled" ||
            !data?.payment.option?.freelanceDirect
          ) {
            post.user = fetch.company.none();
          } else {
            post.user = fetch.company.supplementary(doc, demo);
          }

          break;
        }
        case "companys": {
          if (!("profile" in post)) return;

          if (
            data?.payment.status === "canceled" ||
            !data?.payment.option?.freelanceDirect
          ) {
            post.icon = "none";
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

          break;
        }
        default:
          break;
      }
    }
  }
};

const fetchActivity = async (
  context: functions.https.CallableContext,
  index: "matters" | "resources",
  post: Algolia.Matter | Algolia.Resource
): Promise<{ likes: number }> => {
  const demo = checkDemo(context);

  type Collections = { likes: number };

  const collections: Collections = {
    likes: !demo ? 0 : dummy.num(99, 999),
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
  context.auth?.uid === functions.config().demo.freelance_direct.uid;
