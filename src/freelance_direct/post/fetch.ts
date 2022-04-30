import * as functions from "firebase-functions";
import { algolia, SearchOptions, RequestOptions } from "../../_algolia";
import { converter, db, location, runtime } from "../../_firebase";
import { userAuthenticated } from "./_userAuthenticated";
import * as fetch from "./_fetch";
import * as Algolia from "../../types/algolia";
import * as Firestore from "../../types/firestore";
import { log } from "../../_utils";

type Data = {
  index: "matters" | "companys";
  target: string | null;
  value: string | null;
  type: string | null;
  page?: number;
};

type Result = Algolia.Matter | Algolia.CompanyItem;

export const fetchPost = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: string, context) => {
    await userAuthenticated(context);
    const demo = checkDemo(context);

    const post = await fetchAlgolia.post(data, demo);
    const bests = await fetchAlgolia.bests(post);

    if (!demo) await addHistory(context, post);

    await log({
      doc: context.auth?.uid,
      run: "fetchPost",
      index: "matters",
      code: 200,
      objectID: post.objectID,
    });

    return { post: post, bests: bests };
  });

export const fetchPosts = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await userAuthenticated(context);
    const demo = checkDemo(context);

    const { posts, hit } = await fetchAlgolia.search(data, demo);

    await fetchFirestore.search(data.index, posts);

    await log({
      doc: context.auth?.uid,
      run: "homePosts",
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

const fetchAlgolia = {
  post: async (data: string, demo: boolean): Promise<Algolia.Matter> => {
    const index = algolia.initIndex("matters");

    const hit = await index.getObject<Algolia.Matter>(data).catch(() => {
      throw new functions.https.HttpsError(
        "not-found",
        "投稿の取得に失敗しました",
        "notFound"
      );
    });

    const post = hit.display === "public" && fetch.matter(hit);

    if (!post) {
      throw new functions.https.HttpsError(
        "not-found",
        "投稿の取得に失敗しました",
        "notFound"
      );
    }

    await fetchFirestore.post({ demo, post });

    return post;
  },

  search: async (
    data: Data,
    demo: boolean
  ): Promise<{
    posts: Result[];
    hit: Algolia.Hit;
  }> => {
    const index = algolia.initIndex(
      !data.target || data.target === "createAt"
        ? data.index
        : `${data.index}_${data.target}_${data.type}`
    );

    const hit: Algolia.Hit = {
      currentPage: data.page ? data.page : 0,
    };

    const value = data.value ? data.value : "";

    const options: (RequestOptions & SearchOptions) | undefined = (() => {
      switch (data.index) {
        case "matters":
          return {
            filters: "display:public",
            page: hit.currentPage,
          };

        case "matters":
          return {
            filters: "status:enable AND plan:enable AND freelanceDirect:enable",
            page: hit.currentPage,
          };

        default:
          return {};
      }
    })();

    const result = await index
      .search<Algolia.Matter | Algolia.Company>(value, options)
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
      ?.map((hit) => {
        switch (data.index) {
          case "matters": {
            return fetch.matter(<Algolia.Matter>hit);
          }

          case "companys": {
            if ((hit as Algolia.Company).person)
              return fetch.company.item(<Algolia.Company>hit, demo);
          }

          default:
            return;
        }
      })
      ?.filter((post): post is Result => post !== undefined);

    return { posts, hit };
  },

  bests: async (post: Algolia.Matter): Promise<Algolia.Matter[] | void> => {
    const index = algolia.initIndex("matters");

    const options: (RequestOptions & SearchOptions) | undefined = {
      queryLanguages: ["ja", "en"],
      similarQuery: post?.handles?.join(" "),
      filters: "display:public",
      hitsPerPage: 100,
    };

    const { hits } = await index
      .search<Algolia.Matter>("", options)
      .catch(() => {
        throw new functions.https.HttpsError(
          "not-found",
          "投稿の取得に失敗しました",
          "algolia"
        );
      });

    const bests = hits
      ?.map((hit) => hit.objectID !== post.objectID && fetch.matter(hit))
      ?.filter((post) => post) as Algolia.Matter[];

    if (bests.length) {
      for (const post of bests) {
        post && (await fetchFirestore.post({ post }));
      }

      return bests;
    }

    return;
  },
};

const fetchFirestore = {
  post: async ({
    demo,
    post,
  }: {
    demo?: boolean;
    post: Algolia.Matter;
  }): Promise<void> => {
    const doc = await db
      .collection("companys")
      .withConverter(converter<Firestore.Company>())
      .doc(post.uid)
      .get()
      .catch(() => {
        throw new functions.https.HttpsError(
          "not-found",
          "ユーザーの取得に失敗しました",
          "notFound"
        );
      });

    if (doc.exists) {
      if (!post) return;

      const data = doc.data();

      if (
        data?.payment.status === "canceled" ||
        !data?.payment.option?.freelanceDirect
      ) {
        post.uid = "";
        post.costs.display = "private";
        post.costs.type = "応談";
        post.costs.min = 0;
        post.costs.max = 0;
        post.user = fetch.company.office(demo);
      } else {
        post.user = fetch.company.supplementary(doc, demo);
      }
    }

    return;
  },

  search: async (index: Data["index"], posts: Result[]) => {
    for (const post of posts) {
      if (!post) continue;

      const doc = await db
        .collection("companys")
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

            if (
              data?.payment.status === "canceled" ||
              !data?.payment.option?.freelanceDirect
            ) {
              post.costs.display = "private";
              post.costs.type = "応談";
              post.costs.min = 0;
              post.costs.max = 0;
            }

            break;
          }

          case "matters": {
            if (!("profile" in post)) return;

            if (
              data?.payment.status === "canceled" ||
              !data?.payment.option?.freelanceDirect
            ) {
              post.icon = "none";
              post.status = "none";
              post.type = "individual";
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

    return;
  },
};

const addHistory = async (
  context: functions.https.CallableContext,
  post: Algolia.Matter
): Promise<void> => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証されていないユーザーではログインできません",
      "auth"
    );
  }

  const timestamp = Date.now();

  const collection = db
    .collection("persons")
    .doc(context.auth.uid)
    .collection("histories")
    .withConverter(converter<Firestore.Post>());

  const querySnapshot = await collection
    .where("index", "==", "matters")
    .where("objectID", "==", post.objectID)
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
      index: "matters",
      objectID: post.objectID,
      uid: post.uid,
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

const checkDemo = (context: functions.https.CallableContext): boolean =>
  context.auth?.uid === functions.config().demo.freelance_direct.uid;
