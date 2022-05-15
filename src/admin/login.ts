import * as functions from "firebase-functions";
import { converter, db, location, runtime } from "../_firebase";
import { userAuthenticated } from "./_userAuthenticated";
import * as Firestore from "../types/firestore";
import { algolia, SearchOptions, RequestOptions } from "../_algolia";
import * as Algolia from "../types/algolia";

type Data = {
  seshub: {
    [key in string]: Firestore.Data | boolean;
  };
  freelanceDirect: {
    [key in string]: Firestore.Data | boolean;
  };
};

type Posts = {
  matters: {
    total: number;
    private: number;
  };
  resources: {
    total: number;
    private: number;
  };
  companys: {
    total: number;
    hold: number;
  };
  persons: {
    total: number;
    hold: number;
  };
};

type Search =
  | Algolia.Matter
  | Algolia.Resource
  | Algolia.Company
  | Algolia.Person;

export const login = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (_data: unknown, context) => {
    const uid = await userAuthenticated(context);

    const data = await fetchCollection();
    const posts = await fetchAlgolia();

    return { uid, data, posts };
  });

const fetchAlgolia = async (): Promise<Posts> => {
  const posts: Posts = {
    matters: {
      total: 0,
      private: 0,
    },
    resources: {
      total: 0,
      private: 0,
    },
    companys: {
      total: 0,
      hold: 0,
    },
    persons: {
      total: 0,
      hold: 0,
    },
  };

  await Promise.allSettled(
    Object.keys(posts).map(async (index) => {
      const algoliaIndex = algolia.initIndex(index);

      await Promise.allSettled(
        Object.keys(posts[index as keyof Posts]).map(async (kind) => {
          const options: RequestOptions & SearchOptions = (() => {
            switch (kind) {
              case "private":
                return {
                  filters: "display:private",
                };

              case "hold":
                return {
                  filters: "status:hold",
                };

              default:
                return {};
            }
          })();

          const { nbHits } = await algoliaIndex
            .search<Search>("", options)
            .catch(() => {
              throw new functions.https.HttpsError(
                "not-found",
                "投稿の取得に失敗しました",
                "algolia"
              );
            });

          Object.assign(posts[index as keyof Posts], { [kind]: nbHits });
        })
      );
    })
  );

  return posts;
};

const fetchCollection = async (): Promise<Data> => {
  const data: Data = {
    seshub: {
      application: false,
      hold: false,
    },
    freelanceDirect: {
      hold: false,
    },
  };

  await Promise.allSettled(
    Object.keys(data).map(async (index) => {
      const docs = await db
        .collection(index)
        .withConverter(converter<Firestore.Data>())
        .get()
        .catch(() => {
          throw new functions.https.HttpsError(
            "not-found",
            "データの取得に失敗しました",
            "firebase"
          );
        });

      await Promise.allSettled(
        Object.keys(data[index as keyof Data]).map(async (kind) => {
          const collection = await db
            .collection(index === "seshub" ? "companys" : "persons")
            .withConverter(converter<Firestore.Company | Firestore.Person>())
            .where(
              kind === "application" ? kind : "status",
              "==",
              kind === "application" ? true : kind
            )
            .orderBy("lastLogin", "desc")
            .get();

          if (collection?.docs?.length) {
            Object.assign(data[index as keyof Data], { [kind]: true });
          }
        })
      );

      docs.forEach((doc) => {
        Object.assign(data[index as keyof Data], { [doc.id]: doc.data() });
      });
    })
  );

  return data;
};
