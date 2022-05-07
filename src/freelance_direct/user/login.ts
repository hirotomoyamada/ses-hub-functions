import * as functions from "firebase-functions";
import { algolia } from "../../_algolia";
import { converter, db, location, runtime } from "../../_firebase";
const loginAuthenticated = require("./_loginAuthenticated").loginAuthenticated;
import * as fetch from "./_fetch";
import * as Firestore from "../../types/firestore";
import { log } from "../../_utils";

export type Data = {
  providerData: {
    displayName: string;
    email: string;
    phoneNumber: number | null;
    providerId: string;
    uid: string;
  }[];
  emailVerified: boolean;
};

type Collections = {
  [key: string]: string[] | { [key: string]: string[] };
};

export const login = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data, context) => {
    await loginAuthenticated({ context, data });

    const user = await fetchUser(context, data);
    const freelanceDirect = await fetchData();
    const demo = checkDemo(context);

    await log({
      auth: { collection: "persons", doc: context.auth?.uid },
      run: "login",
      code: 200,
    });

    return {
      user: user,
      data: freelanceDirect,
      demo: demo,
    };
  });

const fetchUser = async (
  context: functions.https.CallableContext,
  data: Data
) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証されていないユーザーではログインできません",
      "auth"
    );
  }

  const timestamp = Date.now();

  const doc = await db
    .collection("persons")
    .withConverter(converter<Firestore.Person>())
    .doc(context.auth.uid)
    .get();

  if (doc.exists) {
    await updateAlgolia(context, timestamp);

    if (doc.data()?.provider.length !== data.providerData.length) {
      await updateProvider(doc, data, timestamp);
      await loginAuthenticated({ doc: doc });

      const collections = await fetchCollections(context);

      return {
        ...fetch.login({ context, doc, data }),
        ...collections,
      };
    } else {
      await updateLogin(doc, timestamp);
      await loginAuthenticated({ doc });

      const collections = await fetchCollections(context);

      return { ...fetch.login({ context, doc }), ...collections };
    }
  } else {
    throw new functions.https.HttpsError(
      "not-found",
      "プロフィールが存在しません",
      "profile"
    );
  }
};

const fetchCollections = async (
  context: functions.https.CallableContext
): Promise<Collections> => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証されていないユーザーではログインできません",
      "auth"
    );
  }

  const collections: Collections = {
    follows: [],
    home: [],
    likes: [],
    entries: [],
    histories: [],
    requests: { enable: [], hold: [], disable: [] },
  };

  for (const key of Object.keys(collections)) {
    const querySnapshot = await db
      .collection("persons")
      .doc(context.auth.uid)
      .collection(key === "home" ? "follows" : key)
      .where("active", "==", true)
      .orderBy("updateAt", "desc")
      .withConverter(converter<Firestore.Post | Firestore.User>())
      .get()
      .catch(() => {});

    if (!querySnapshot) {
      continue;
    }

    querySnapshot.forEach((doc) => {
      const collection = collections[key];
      const data = doc.data();

      if (collection instanceof Array) {
        if ("objectID" in data) {
          const objectID = data.objectID;

          Object.assign(collections, {
            [key]: [...collection, objectID],
          });
        } else {
          const uid = data.uid;

          if ("home" in data) {
            const home = data.home;

            if (home) {
              Object.assign(collections, {
                [key]: [...collection, uid],
              });
            }
          } else {
            Object.assign(collections, {
              [key]: [...collection, uid],
            });
          }
        }
      } else {
        if ("status" in data) {
          const status = data.status;
          const uid = data.uid;

          if (status) {
            Object.assign(collections[key], {
              [status]: [...collection[status], uid],
            });
          }
        }
      }
    });
  }

  return collections;
};

const updateLogin = async (
  doc: FirebaseFirestore.DocumentSnapshot<Firestore.Person>,
  timestamp: number
): Promise<void> => {
  await doc.ref.set(
    {
      lastLogin: timestamp,
    },
    { merge: true }
  );
};

const updateProvider = async (
  doc: FirebaseFirestore.DocumentSnapshot<Firestore.Person>,
  data: Data,
  timestamp: number
): Promise<void> => {
  await doc.ref
    .set(
      {
        provider: data.providerData.map((provider) => provider.providerId),
        updateAt: timestamp,
        lastLogin: timestamp,
      },
      { merge: true }
    )
    .catch(() => {
      throw new functions.https.HttpsError(
        "data-loss",
        "プロバイダーの更新に失敗しました",
        "provider"
      );
    });
};

const updateAlgolia = async (
  context: functions.https.CallableContext,
  timestamp: number
): Promise<void> => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証されていないユーザーではログインできません",
      "auth"
    );
  }

  const index = algolia.initIndex("persons");

  await index
    .partialUpdateObject({
      objectID: context.auth.uid,
      lastLogin: timestamp,
    })
    .catch(() => {
      throw new functions.https.HttpsError(
        "data-loss",
        "投稿の編集に失敗しました",
        "algolia"
      );
    });
};

const fetchData = async (): Promise<Firestore.Data> => {
  let data = {} as Firestore.Data;

  const querySnapshot = await db
    .collection("freelanceDirect")
    .withConverter(converter<Firestore.Data>())
    .get()
    .catch(() => {
      throw new functions.https.HttpsError(
        "not-found",
        "データの取得に失敗しました",
        "firebase"
      );
    });

  querySnapshot.forEach((doc) => {
    data = { ...data, [doc.id]: doc.data() };
  });

  return data;
};

const checkDemo = (context: functions.https.CallableContext): boolean =>
  context.auth?.uid === functions.config().demo.freelance_direct.uid;
