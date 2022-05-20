import * as functions from "firebase-functions";
import { algolia, SearchOptions, RequestOptions } from "../../_algolia";
import { converter, db, location, runtime } from "../../_firebase";
import { userAuthenticated } from "./_userAuthenticated";
import * as fetch from "./_fetch";
import * as Algolia from "../../types/algolia";
import * as Firestore from "../../types/firestore";
import { dummy, log } from "../../_utils";

type Data = {
  index: "matters" | "companys";
  target: string | null;
  value: string | null;
  type: string | null;
  page?: number;
};

export const fetchPost = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: string, context) => {
    await userAuthenticated(context);
    const demo = checkDemo(context);

    const post = await fetchAlgolia.post(context, data);
    const bests = await fetchAlgolia.bests(context, post);

    if (!demo) await addHistory(context, post);

    await log({
      auth: { collection: "persons", doc: context.auth?.uid },
      run: "fetchPost",
      index: "matters",
      code: 200,
      objectID: post.objectID,
    });

    return { post: post, bests: bests?.filter((post) => post !== undefined) };
  });

export const fetchPosts = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await userAuthenticated(context);
    const demo = checkDemo(context);

    const { posts, hit } = await fetchAlgolia.search(data, demo);

    await fetchFirestore.search(context, data.index, posts);

    await log({
      auth: { collection: "persons", doc: context.auth?.uid },
      run: "homePosts",
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
      posts: (posts as any[]).filter((post) => post !== undefined),
      hit: hit,
    };
  });

const fetchAlgolia = {
  post: async (
    context: functions.https.CallableContext,
    data: string
  ): Promise<Algolia.Matter> => {
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

    await fetchFirestore.post({ context, post });

    return post;
  },

  search: async (
    data: Data,
    demo: boolean
  ): Promise<{
    posts: Algolia.Matter[] | Algolia.CompanyItem[];
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

        case "companys":
          return {
            filters: "status:enable AND plan:enable AND freelanceDirect:enable",
            page: hit.currentPage,
          };

        default:
          return {};
      }
    })();

    const { hits, nbHits, nbPages } = await index
      .search<Algolia.Matter | Algolia.Company>(value, options)
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
        case "matters": {
          return hits?.map((hit) => fetch.matter(<Algolia.Matter>hit));
        }

        case "companys":
          return hits
            ?.map((hit) => {
              if ((hit as Algolia.Company).person)
                return fetch.company.item(<Algolia.Company>hit, demo);

              return;
            })
            ?.filter((post): post is Algolia.CompanyItem => post !== undefined);

        default:
          throw new functions.https.HttpsError(
            "not-found",
            "投稿の取得に失敗しました",
            "algolia"
          );
      }
    })();

    return { posts, hit };
  },

  bests: async (
    context: functions.https.CallableContext,
    post: Algolia.Matter
  ): Promise<Algolia.Matter[] | void> => {
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
        post && (await fetchFirestore.post({ context, post }));
      }

      return bests;
    }

    return;
  },
};

const fetchFirestore = {
  post: async ({
    context,
    post,
  }: {
    context: functions.https.CallableContext;
    post: Algolia.Matter;
  }): Promise<void> => {
    const demo = checkDemo(context);

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

    if (!doc.exists || !post) return;

    const data = doc.data();

    const { likes } = await fetchActivity(context, "matters", post);

    post.likes = likes;

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

    return;
  },

  search: async (
    context: functions.https.CallableContext,
    index: Data["index"],
    posts: Algolia.Matter[] | (Algolia.CompanyItem | undefined)[]
  ): Promise<void> => {
    await Promise.allSettled(
      posts.map(async (_, i) => {
        const post = posts[i];

        if (!post) return;

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

              const { likes } = await fetchActivity(context, index, post);

              post.likes = likes;

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

            case "companys": {
              if (!("profile" in post)) return;

              if (
                data?.payment.status !== "canceled" &&
                data?.payment.option?.freelanceDirect
              ) {
                post.icon = data?.icon;
                post.type = data?.type;
              } else {
                posts[i] = undefined;
              }

              break;
            }

            default:
              break;
          }
        }
      })
    );

    return;
  },
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
      type: null,
      payment: null,
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
