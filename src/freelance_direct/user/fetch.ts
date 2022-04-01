import * as functions from "firebase-functions";
import { algolia } from "../../algolia";
import { converter, db, location, runtime } from "../../firebase";
import { userAuthenticated } from "./_userAuthenticated";
import * as fetch from "./_fetch";
import * as Algolia from "../../types/algolia";
import * as Firestore from "../../types/firestore";

export const fetchUser = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: string, context) => {
    await userAuthenticated({ context });

    const demo = checkDemo(context);
    const user = await fetchAlgolia(data, demo);

    await fetchFirestore(data, user);
    !demo && (await addHistory(context, data));

    return user;
  });

const fetchAlgolia = async (
  data: string,
  demo: boolean
): Promise<Algolia.CompanyItem> => {
  const index = algolia.initIndex("companys");

  const hit = await index.getObject<Algolia.Company>(data).catch(() => {
    throw new functions.https.HttpsError(
      "not-found",
      "プロフィールの取得に失敗しました",
      "algolia"
    );
  });

  const user = fetch.company(hit, demo);

  if (!user) {
    throw new functions.https.HttpsError(
      "not-found",
      "プロフィールの取得に失敗しました",
      "algolia"
    );
  }

  return user;
};

const fetchFirestore = async (
  data: string,
  user: Algolia.CompanyItem
): Promise<void> => {
  const doc = await db
    .collection("companys")
    .withConverter(converter<Firestore.Company>())
    .doc(data)
    .get()
    .catch(() => {
      throw new functions.https.HttpsError(
        "not-found",
        "ユーザーの取得に失敗しました",
        "firebase"
      );
    });

  if (doc.exists) {
    if (
      doc.data()?.payment.status === "canceled" ||
      !doc.data()?.payment.option?.freelanceDirect
    ) {
      throw new functions.https.HttpsError(
        "cancelled",
        "オプション未加入のユーザーのため、処理中止",
        "firebase"
      );
    } else {
      user.icon = doc.data()?.icon;
      user.cover = doc.data()?.cover;
      user.type = doc.data()?.type;
    }
  }
};

const addHistory = async (
  context: functions.https.CallableContext,
  data: string
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
    .withConverter(converter<Firestore.User>());

  const querySnapshot = await collection
    .where("index", "==", "companys")
    .where("uid", "==", data)
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
      index: "companys",
      uid: data,
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
