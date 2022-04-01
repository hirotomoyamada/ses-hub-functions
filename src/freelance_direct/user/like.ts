import * as functions from "firebase-functions";
import { db, location, runtime, converter } from "../../firebase";
import * as Firestore from "../../types/firestore";
import { userAuthenticated } from "./_userAuthenticated";

type Data = { objectID: string; uid: string };

export const addLike = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await userAuthenticated({ context, demo: true });

    await updateFirestore({ context, data });

    return;
  });

export const removeLike = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data, context) => {
    await userAuthenticated({ context, demo: true });

    await updateFirestore({ context, data });

    return;
  });

const updateFirestore = async ({
  context,
  data,
}: {
  context: functions.https.CallableContext;
  data: Data;
  add?: boolean;
}): Promise<void> => {
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
    .collection("likes")
    .withConverter(converter<Firestore.Post>());

  const querySnapshot = await collection
    .where("objectID", "==", data.objectID)
    .get()
    .catch(() => {
      throw new functions.https.HttpsError(
        "not-found",
        "コレクションの取得に失敗しました",
        "firebase"
      );
    });

  const doc = querySnapshot.docs[0];

  if (doc) {
    const active = doc.data().active;

    await doc.ref
      .set({ active: !active, updateAt: timestamp }, { merge: true })
      .catch(() => {
        throw new functions.https.HttpsError(
          "data-loss",
          "データの更新に失敗しました",
          "firebase"
        );
      });
  } else {
    await collection
      .add({
        index: "matters",
        objectID: data.objectID,
        uid: data.uid,
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
  }

  return;
};
