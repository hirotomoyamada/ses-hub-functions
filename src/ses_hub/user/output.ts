import * as functions from "firebase-functions";
import { converter, db, location, runtime } from "../../firebase";
import { userAuthenticated } from "./_userAuthenticated";
import * as Firestore from "../../types/firestore";

type Data = {
  index: "matters" | "resources";
  objectID: string;
  objectIDs?: string[];
};

export const addOutput = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await userAuthenticated({ context: context, demo: true });

    await updateFirestore({ context: context, data: data });

    return;
  });

export const removeOutput = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
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
    .collection("companys")
    .doc(context.auth.uid)
    .collection("outputs")
    .withConverter(converter<Firestore.Posts>());

  const query = !data.objectIDs
    ? collection
        .where("index", "==", data.index)
        .where("objectID", "==", data.objectID)
    : collection.where("index", "==", data.index);

  const querySnapshot = await query.get().catch(() => {
    throw new functions.https.HttpsError(
      "not-found",
      "ユーザーの取得に失敗しました",
      "firebase"
    );
  });

  const objectIDs = data.objectIDs;

  if (!objectIDs) {
    const doc = querySnapshot.docs[0];

    if (doc) {
      const active = doc.data().active;

      await doc.ref.set({ active: !active }, { merge: true }).catch(() => {
        throw new functions.https.HttpsError(
          "data-loss",
          "いいねの追加に失敗しました",
          "firebase"
        );
      });
    } else {
      await collection
        .add({
          index: data.index,
          objectID: data.objectID,
          active: true,
          at: timestamp,
        })
        .catch(() => {
          throw new functions.https.HttpsError(
            "data-loss",
            "いいねの追加に失敗しました",
            "firebase"
          );
        });
    }
  } else {
    querySnapshot.forEach(async (doc) => {
      const objectID = doc.data().objectID;

      if (objectIDs.indexOf(objectID) >= 0) {
        await doc.ref.set({ active: false }, { merge: true }).catch(() => {
          throw new functions.https.HttpsError(
            "data-loss",
            "いいねの追加に失敗しました",
            "firebase"
          );
        });
      }
    });
  }

  return;
};
