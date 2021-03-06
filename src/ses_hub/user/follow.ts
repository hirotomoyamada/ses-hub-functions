import * as functions from "firebase-functions";
import { converter, db, location, runtime } from "../../_firebase";
import { userAuthenticated } from "./_userAuthenticated";
import * as Firestore from "../../types/firestore";
import { log } from "../../_utils";

export const addFollow = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: string, context) => {
    await userAuthenticated({
      context,
      demo: true,
      canceled: true,
    });

    await updateFirestore({ context, data });

    await log({
      auth: { collection: "companys", doc: context.auth?.uid },
      run: "addFollow",
      index: "companys",
      code: 200,
      uid: data,
    });

    return;
  });

export const removeFollow = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: string, context) => {
    await userAuthenticated({
      context: context,
      demo: true,
      canceled: true,
    });

    await updateFirestore({ context, data });

    await log({
      auth: { collection: "companys", doc: context.auth?.uid },
      run: "removeFollow",
      index: "companys",
      code: 200,
      uid: data,
    });

    return;
  });

const updateFirestore = async ({
  context,
  data,
}: {
  context: functions.https.CallableContext;
  data: string;
}): Promise<void> => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証されていないユーザーではログインできません",
      "auth"
    );
  }

  const timestamp = Date.now();

  const ref = db
    .collection("companys")
    .doc(context.auth.uid)
    .withConverter(converter<Firestore.Company>());

  const collection = ref
    .collection("follows")
    .withConverter(converter<Firestore.User>());

  const doc = await ref.get().catch(() => {
    throw new functions.https.HttpsError(
      "not-found",
      "データの取得に失敗しました",
      "firebase"
    );
  });

  const querySnapshotDoc = await collection
    .doc(data)
    .get()
    .catch(() => {
      throw new functions.https.HttpsError(
        "not-found",
        "コレクションの取得に失敗しました",
        "firebase"
      );
    });

  const querySnapshot = await collection
    .where("home", "==", true)
    .get()
    .catch(() => {
      throw new functions.https.HttpsError(
        "not-found",
        "コレクションの取得に失敗しました",
        "firebase"
      );
    });

  if (querySnapshotDoc.exists) {
    const active = querySnapshotDoc.data()?.active;
    const home = querySnapshot.docs.length;

    await querySnapshotDoc.ref
      .set(
        {
          active: !active,
          home: active ? !active : home < 15 || false,
          updateAt: timestamp,
        },
        { merge: true }
      )
      .catch(() => {
        throw new functions.https.HttpsError(
          "data-loss",
          "データの更新に失敗しました",
          "firebase"
        );
      });
  } else {
    const home = querySnapshot.docs.length;
    const type = doc.data()?.type || null;
    const payment = doc.data()?.payment.status || null;

    await querySnapshotDoc.ref
      .set({
        index: "companys",
        uid: data,
        active: true,
        home: home < 15 || false,
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
  }

  return;
};
