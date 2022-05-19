import * as functions from "firebase-functions";
import { algolia, SearchOptions, RequestOptions } from "../../_algolia";
import { converter, db, location, runtime } from "../../_firebase";
import { userAuthenticated } from "./_userAuthenticated";
import * as fetch from "./_fetch";
import * as Firestore from "../../types/firestore";
import * as Algolia from "../../types/algolia";
import { dummy, log } from "../../_utils";

type Data = {
  post: { index: "matters" | "resources"; objectID: string };
  posts: {
    index: "matters" | "resources" | "companys" | "persons";
    target?: string;
    value?: string;
    type?: string;
    page?: number;
  };
};

type Post = Algolia.Matter | Algolia.Resource;

type Posts =
  | Algolia.Matter
  | Algolia.Resource
  | Algolia.Company
  | Algolia.Person;

export const fetchPost = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data["post"], context) => {
    const status = await userAuthenticated({
      context,
      canceled: true,
    });

    const post = await fetchAlgolia.post(context, data, status);

    const bests = await fetchAlgolia.bests(context, data, post, status);

    await addHistory(context, data, post);

    await log({
      auth: { collection: "companys", doc: context.auth?.uid },
      run: "fetchPost",
      index: data.index,
      code: 200,
      objectID: data.objectID,
    });

    return { post: post, bests: bests };
  });

export const fetchPosts = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data["posts"], context) => {
    const status = await userAuthenticated({
      context,
      index: data.index,
    });

    const { posts, hit } = await fetchAlgolia.search(context, data);

    if (posts.length)
      await fetchFirestore.search(context, data.index, posts, status);

    await log({
      auth: { collection: "companys", doc: context.auth?.uid },
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

const fetchAlgolia = {
  post: async (
    context: functions.https.CallableContext,
    data: Data["post"],
    status: boolean
  ): Promise<Post> => {
    const index = algolia.initIndex(data.index);

    const hit = await index.getObject<Post>(data.objectID).catch(() => {
      throw new functions.https.HttpsError(
        "not-found",
        "投稿の取得に失敗しました",
        "notFound"
      );
    });

    const post = (() => {
      switch (data.index) {
        case "matters":
          if (hit.uid === context.auth?.uid) {
            return fetch.auth.matter(hit as Algolia.Matter);
          }

          if (hit.display === "public") {
            return fetch.other.matter(hit as Algolia.Matter);
          }

        case "resources":
          if (hit.uid === context.auth?.uid) {
            return fetch.auth.resource(hit as Algolia.Resource);
          }

          if (hit.display === "public") {
            return fetch.other.resource(hit as Algolia.Resource);
          }

        default:
          throw new functions.https.HttpsError(
            "not-found",
            "投稿の取得に失敗しました",
            "notFound"
          );
      }
    })();

    await fetchFirestore.post(context, data.index, post, status);

    if (context.auth?.uid !== post.uid) await updateLimit(context);

    return post;
  },

  search: async (
    context: functions.https.CallableContext,
    data: Data["posts"]
  ): Promise<{
    posts:
      | Algolia.Matter[]
      | Algolia.Resource[]
      | Algolia.CompanyItem[]
      | Algolia.PersonItem[];
    hit: Algolia.Hit;
  }> => {
    const demo = checkDemo(context);

    const index = algolia.initIndex(
      !data.target || data.target === "createAt"
        ? data.index
        : `${data.index}_${data.target}_${data.type}`
    );

    const hit: Algolia.Hit = {
      currentPage: data.page ? data.page : 0,
    };

    const query = data.value ? data.value : "";

    const options: (RequestOptions & SearchOptions) | undefined = (() => {
      switch (data.index) {
        case "matters":
        case "resources":
          return {
            filters: "display:public",
            page: hit.currentPage,
          };

        case "companys":
          return {
            filters: "status:enable AND (plan:enable OR type:individual)",
            page: hit.currentPage,
          };

        case "persons":
          return {
            filters: "status:enable",
            page: hit.currentPage,
          };

        default:
          return;
      }
    })();

    const { hits, nbHits, nbPages } = await index
      .search<Posts>(query, options)
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

        case "companys":
          return hits
            .map((hit) => {
              if ((hit as Algolia.Company).person)
                return fetch.other.company(<Algolia.Company>hit, demo);

              return;
            })
            ?.filter((post): post is Algolia.CompanyItem => post !== undefined);

        case "persons":
          return hits
            .map((hit) => {
              if ((hit as Algolia.Person).nickName)
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
  },

  bests: async (
    context: functions.https.CallableContext,
    data: Data["post"],
    post: Algolia.Matter | Algolia.Resource,
    status: boolean
  ): Promise<Algolia.Matter[] | Algolia.Resource[]> => {
    const index = algolia.initIndex(data.index);

    const options: (RequestOptions & SearchOptions) | undefined = {
      queryLanguages: ["ja", "en"],
      similarQuery: post?.handles?.join(" "),
      filters: "display:public",
      hitsPerPage: 100,
    };

    const { hits } = await index.search<Post>("", options).catch(() => {
      throw new functions.https.HttpsError(
        "not-found",
        "投稿の取得に失敗しました",
        "algolia"
      );
    });

    const bests = (() => {
      switch (data.index) {
        case "matters":
          return hits
            ?.map((hit) => {
              if (hit.objectID !== post.objectID)
                if (hit.uid === context.auth?.uid) {
                  return fetch.auth.matter(<Algolia.Matter>hit);
                } else {
                  return fetch.other.matter(<Algolia.Matter>hit);
                }

              return;
            })
            ?.filter((post): post is Algolia.Matter => post !== undefined);

        case "resources":
          return hits
            ?.map((hit) => {
              if (hit.objectID !== post.objectID)
                if (hit.uid === context.auth?.uid) {
                  return fetch.auth.resource(<Algolia.Resource>hit);
                } else {
                  return fetch.other.resource(<Algolia.Resource>hit);
                }

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

    if (bests.length)
      await fetchFirestore.search(context, data.index, bests, status);

    return bests;
  },
};

const fetchFirestore = {
  post: async (
    context: functions.https.CallableContext,
    index: Data["post"]["index"],
    post: Post,
    status: boolean
  ): Promise<void> => {
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

    if (!doc.exists) return;

    const data = doc.data();

    if (data?.type !== "individual" && data?.payment.status === "canceled") {
      throw new functions.https.HttpsError(
        "not-found",
        "投稿の取得に失敗しました",
        "notFound"
      );
    }

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

    const { likes, outputs, entries } = await fetchActivity.post(
      context,
      index,
      post
    );

    post.likes = likes;
    post.outputs = outputs;
    post.entries = entries;
  },

  search: async (
    context: functions.https.CallableContext,
    index: Data["posts"]["index"],
    posts:
      | (Algolia.Matter | undefined)[]
      | (Algolia.Resource | undefined)[]
      | Algolia.CompanyItem[]
      | Algolia.PersonItem[],
    status: boolean
  ): Promise<void> => {
    const demo = checkDemo(context);

    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "認証されていないユーザーではログインできません",
        "auth"
      );
    }

    await Promise.allSettled(
      posts.map(async (_, i) => {
        const post = posts[i];

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
                const { likes, outputs, entries } = await fetchActivity.post(
                  context,
                  index,
                  post
                );

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
            }
            break;

          case "companys":
            {
              if (!("type" in post)) return;
              const data = doc.data() as Firestore.Company;

              post.icon = data.icon;
              post.type = data.type;
              post.status = data.payment.status;
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
              post.likes = likes;
              post.request = requests;
            }
            break;

          default:
            return;
        }
      })
    );
  },
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

const updateLimit = async (
  context: functions.https.CallableContext
): Promise<void> => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証されていないユーザーではログインできません",
      "auth"
    );
  }

  const doc = await db
    .collection("companys")
    .withConverter(converter<Firestore.Company>())
    .doc(context.auth.uid)
    .get();

  const data = doc.data();

  if (doc.exists && data?.payment.status === "canceled") {
    const limit = data.payment.limit;

    if (!limit || limit <= 0) {
      throw new functions.https.HttpsError(
        "cancelled",
        "閲覧回数の上限を超えたため、閲覧することができません",
        "limit"
      );
    } else {
      await doc.ref
        .set(
          {
            payment: Object.assign(data.payment, {
              limit: limit ? limit - 1 : 0,
            }),
          },
          { merge: true }
        )
        .catch(() => {
          throw new functions.https.HttpsError(
            "data-loss",
            "閲覧回数の更新に失敗しました",
            "firebase"
          );
        });
    }
  }

  return;
};

const addHistory = async (
  context: functions.https.CallableContext,
  data: Data["post"],
  post: Post
): Promise<void> => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証されていないユーザーではログインできません",
      "auth"
    );
  }

  if (context.auth.uid === post.uid) {
    return;
  }

  const timestamp = Date.now();

  const ref = db
    .collection("companys")
    .doc(context.auth.uid)
    .withConverter(converter<Firestore.Company>());

  const collection = ref
    .collection("histories")
    .withConverter(converter<Firestore.Post>());

  const doc = await ref.get().catch(() => {
    throw new functions.https.HttpsError(
      "not-found",
      "データの取得に失敗しました",
      "firebase"
    );
  });

  const querySnapshot = await collection
    .where("index", "==", data.index)
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

  const type = doc.data()?.type || null;
  const payment = doc.data()?.payment.status || null;

  await collection
    .add({
      index: data.index,
      objectID: post.objectID,
      uid: post.uid,
      active: true,
      type,
      payment,
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
  context.auth?.uid === functions.config().demo.ses_hub.uid;
