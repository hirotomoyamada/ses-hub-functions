import * as functions from "firebase-functions";
import { db, location, runtime, converter } from "../../_firebase";
import { userAuthenticated } from "./_userAuthenticated";
import * as Firestore from "../../types/firestore";
import { log } from "../../_utils";

type Data = {
  index: "matters" | "resources";
  uid: string;
  objectID: string;
};

export const addEntry = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await userAuthenticated({
      context,
      demo: true,
    });

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
      .collection("entries")
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
      .where("objectID", "==", data.objectID)
      .get()
      .catch(() => {
        throw new functions.https.HttpsError(
          "not-found",
          "コレクションの取得に失敗しました",
          "firebase"
        );
      });

    const type = doc.data()?.type || null;
    const payment = doc.data()?.payment.status || null;

    const querySnapshotDoc = querySnapshot.docs[0];

    if (!querySnapshotDoc) {
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

    await log({
      auth: { collection: "companys", doc: context.auth?.uid },
      run: "addEntry",
      index: data.index,
      code: 200,
      objectID: data.objectID,
    });

    return;
  });
