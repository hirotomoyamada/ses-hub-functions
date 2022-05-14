import * as functions from "firebase-functions";
import { converter, db, location, runtime } from "../../_firebase";
import { userAuthenticated } from "./_userAuthenticated";
import * as Firestore from "../../types/firestore";
import { log } from "../../_utils";

type Data = {
  index: "matters" | "resources";
  uid?: string;
  objectID?: string;
  objectIDs?: string[];
};

export const addOutput = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await userAuthenticated({ context, demo: true });

    await updateFirestore({ context, data });

    await log({
      auth: { collection: "companys", doc: context.auth?.uid },
      run: "addOutput",
      index: data.index,
      code: 200,
      objectID: data.objectID || data.objectIDs,
    });

    return;
  });

export const removeOutput = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await userAuthenticated({ context, demo: true });

    await updateFirestore({ context, data });

    await log({
      auth: { collection: "companys", doc: context.auth?.uid },
      run: "removeOutput",
      index: data.index,
      code: 200,
      objectID: data.objectID || data.objectIDs,
    });
    return;
  });

const updateFirestore = async ({
  context,
  data,
}: {
  context: functions.https.CallableContext;
  data: Data;
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
    .collection("outputs")
    .withConverter(converter<Firestore.Post>());

  const query = !data.objectIDs
    ? collection
        .where("index", "==", data.index)
        .where("objectID", "==", data.objectID)
    : collection.where("index", "==", data.index);

  const doc = await ref.get().catch(() => {
    throw new functions.https.HttpsError(
      "not-found",
      "データの取得に失敗しました",
      "firebase"
    );
  });

  const querySnapshot = await query.get().catch(() => {
    throw new functions.https.HttpsError(
      "not-found",
      "コレクションの取得に失敗しました",
      "firebase"
    );
  });

  const objectIDs = data.objectIDs;

  if (!objectIDs) {
    const querySnapshotDoc = querySnapshot.docs[0];

    if (querySnapshotDoc) {
      const active = querySnapshotDoc.data().active;

      await querySnapshotDoc.ref
        .set({ active: !active, updateAt: timestamp }, { merge: true })
        .catch(() => {
          throw new functions.https.HttpsError(
            "data-loss",
            "データの更新に失敗しました",
            "firebase"
          );
        });
    } else {
      const type = doc.data()?.type || null;
      const payment = doc.data()?.payment.status || null;

      if (!data.uid || !data.objectID) {
        throw new functions.https.HttpsError(
          "data-loss",
          "データの追加に失敗しました",
          "firebase"
        );
      }

      await collection
        .add({
          index: data.index,
          uid: data.uid,
          objectID: data.objectID,
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
    }
  } else {
    querySnapshot.forEach(async (doc) => {
      const objectID = doc.data().objectID;

      if (objectIDs.indexOf(objectID) >= 0) {
        await doc.ref
          .set({ active: false, updateAt: timestamp }, { merge: true })
          .catch(() => {
            throw new functions.https.HttpsError(
              "data-loss",
              "データの削除に失敗しました",
              "firebase"
            );
          });
      }
    });
  }

  return;
};
