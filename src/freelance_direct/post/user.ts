import * as functions from "firebase-functions";
import { algolia, SearchOptions, RequestOptions } from "../../_algolia";
import { converter, db, location, runtime } from "../../_firebase";
import { userAuthenticated } from "./_userAuthenticated";
import * as fetch from "./_fetch";
import * as Firestore from "../../types/firestore";
import * as Algolia from "../../types/algolia";
import { dummy, log } from "../../_utils";

type Data = {
  uid: string;
  page?: number;
};

export const userPosts = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await userAuthenticated(context);

    await checkUser(data.uid);

    const { posts, hit } = await fetchAlgolia(context, data);

    await log({
      auth: { collection: "persons", doc: context.auth?.uid },
      run: "homePosts",
      index: "matters",
      code: 200,
      objectID: posts
        ?.map((post) => (post ? post.objectID : undefined))
        ?.filter((post): post is string => post !== undefined),
    });

    return { posts: posts, hit: hit };
  });

const checkUser = async (uid: Data["uid"]): Promise<void> => {
  const doc = await db
    .collection("companys")
    .withConverter(converter<Firestore.Company>())
    .doc(uid)
    .get();

  const data = doc.data();

  if (
    data?.payment.status === "canceled" ||
    !data?.payment.option?.freelanceDirect
  ) {
    throw new functions.https.HttpsError(
      "cancelled",
      "投稿の取得に失敗しました",
      "firebase"
    );
  }
};

const fetchAlgolia = async (
  context: functions.https.CallableContext,
  data: Data
): Promise<{
  posts: Algolia.Matter[];
  hit: Algolia.Hit;
}> => {
  const index = algolia.initIndex("matters");

  const hit: Algolia.Hit = {
    currentPage: data.page ? data.page : 0,
  };

  const options: (RequestOptions & SearchOptions) | undefined = {
    filters: "display:public",
    page: hit.currentPage,
  };

  const result = await index
    .search<Algolia.Matter>(data.uid, options)
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
    .map((hit) => (hit ? fetch.matter(hit) : undefined))
    ?.filter((post): post is Algolia.Matter => post !== undefined);

  for (const post of posts) {
    const { likes } = await fetchActivity(context, "matters", post);

    post.likes = likes;
  }

  return { posts, hit };
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
