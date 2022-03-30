import * as functions from "firebase-functions";
import { converter, db, location, runtime } from "../../firebase";
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
      context: context,
      demo: true,
      index: data.index,
    });

    await updateFirestore({ context: context, data: data });

    return;
  });

export const removeLike = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data, context) => {
    await userAuthenticated({ context: context, demo: true });

    await updateFirestore({ context: context, data: data });

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
    .withConverter(converter<Firestore.Posts | Firestore.Users>());

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

    await doc.ref.set({ active: !active }, { merge: true }).catch(() => {
      throw new functions.https.HttpsError(
        "data-loss",
        "データの更新に失敗しました",
        "firebase"
      );
    });
  } else {
    await collection
      .add(
        data.objectID
          ? {
              index: data.index,
              objectID: data.objectID,
              active: true,
              at: timestamp,
            }
          : {
              index: data.index,
              uid: data.uid,
              active: true,
              at: timestamp,
            }
      )
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
