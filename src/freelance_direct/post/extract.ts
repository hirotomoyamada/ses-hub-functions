import * as functions from "firebase-functions";
import { algolia } from "../../_algolia";
import { converter, db, location, runtime } from "../../_firebase";
import { userAuthenticated } from "./_userAuthenticated";
import * as fetch from "./_fetch";
import * as Algolia from "../../types/algolia";
import * as Firestore from "../../types/firestore";
import { dummy, log } from "../../_utils";

type Data = {
  index: "matters" | "companys" | "enable" | "hold" | "disable";
  type: "likes" | "entries" | "requests" | "histories";
  objectIDs: string[];
  page?: number;
};

type Posts = Algolia.Matter | Algolia.Company;

type Results = Algolia.Matter | Algolia.CompanyItem;

export const extractPosts = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data, context) => {
    await userAuthenticated(context);
    const demo = checkDemo(context);

    const { posts, hit } = await fetchAlgolia(data, demo);

    if (posts.length) await fetchFirestore(context, data.index, posts);

    await log({
      auth: { collection: "persons", doc: context.auth?.uid },
      run: "fetchPosts",
      index: data.type !== "requests" ? "matters" : "companys",
      code: 200,
      objectID: posts
        ?.map((post) =>
          post ? ("objectID" in post && post.objectID) || post.uid : undefined
        )
        ?.filter((post): post is string => post !== undefined),
    });

    return { index: data.index, type: data.type, posts: posts, hit: hit };
  });

const fetchAlgolia = async (
  data: Data,
  demo: boolean
): Promise<{
  posts: Results[];
  hit: Algolia.Hit;
}> => {
  const index = algolia.initIndex(
    data.type !== "requests" ? "matters" : "companys"
  );

  const objectIDs = data.objectIDs;

  const hitsPerPage = 50;

  const hit: Algolia.Hit = {
    posts: objectIDs.length,
    pages: Math.ceil(objectIDs.length / 50),
    currentPage: data.page ? data.page : 0,
  };

  const { results } = await index
    .getObjects<Posts>(
      objectIDs.slice(
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
    ?.map((hit) => {
      switch (data.index) {
        case "matters": {
          if (hit && (hit as Algolia.Matter).display === "public")
            return fetch.matter(<Algolia.Matter>hit);
        }

        case "companys":
        case "enable":
        case "hold":
        case "disable": {
          if (
            hit &&
            data.type === "requests" &&
            (hit as Algolia.Company).status === "enable"
          )
            return fetch.company.item(<Algolia.Company>hit, demo);
        }

        default:
          return;
      }
    })
    ?.filter((post): post is Results => post !== undefined);

  return { posts, hit };
};

const fetchFirestore = async (
  context: functions.https.CallableContext,
  index: Data["index"],
  posts: Results[]
): Promise<void> => {
  await Promise.allSettled(
    posts.map(async (_, i) => {
      const post = posts[i];

      if (!post) return;

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

      if (!doc.exists) return;

      switch (index) {
        case "matters": {
          if (!("objectID" in post)) return;

          const { likes } = await fetchActivity(context, index, post);

          post.likes = likes;

          const data = doc.data();

          if (!data?.payment.option && !data?.payment.option?.freelanceDirect) {
            post.costs.display = "private";
            post.costs.type = "応談";
            post.costs.min = 0;
            post.costs.max = 0;
          }

          break;
        }

        case "companys":
        case "enable":
        case "hold":
        case "disable": {
          if (!("profile" in post)) return;

          const data = doc.data();

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
    })
  );
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
};

const checkDemo = (context: functions.https.CallableContext): boolean =>
  context.auth?.uid === functions.config().demo.freelance_direct.uid;
