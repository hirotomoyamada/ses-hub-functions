import * as functions from "firebase-functions";
import { converter, db, location, runtime } from "../../_firebase";
import { userAuthenticated } from "./_userAuthenticated";
import * as Firestore from "../../types/firestore";

type Data = {
  index: "matters" | "resources" | "persons";
  uid: string;
  objectID?: string;
};

export const addLike = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await userAuthenticated({
      context,
      demo: true,
      index: data.index,
    });

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
    .collection("companys")
    .doc(context.auth.uid)
    .collection("likes")
    .withConverter(converter<Firestore.Post | Firestore.User>());

  const querySnapshot = await collection
    .where("index", "==", data.index)
    .where(data.objectID ? "objectID" : "uid", "==", data.objectID || data.uid)
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
    if (data.index !== "persons") {
      if (!data.objectID) {
        throw new functions.https.HttpsError(
          "data-loss",
          "データの追加に失敗しました",
          "firebase"
        );
      }

      await collection
        .add({
          index: data.index,
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
    } else {
      await collection
        .add({
          index: data.index,
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
  }

  return;
};
