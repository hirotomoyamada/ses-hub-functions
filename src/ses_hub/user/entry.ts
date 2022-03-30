import * as functions from "firebase-functions";
import { db, location, runtime, converter } from "../../firebase";
import { userAuthenticated } from "./_userAuthenticated";
import * as Firestore from "../../types/firestore";

type Data = {
  index: "matters" | "resources" | "persons";
  objectID: string;
};

export const addEntry = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await userAuthenticated({
      context: context,
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

    const collection = db
      .collection("companys")
      .doc(context.auth.uid)
      .collection("entries")
      .withConverter(converter<Firestore.Posts>());

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

    const doc = querySnapshot.docs[0];

    if (!doc) {
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
            "データの追加に失敗しました",
            "firebase"
          );
        });
    }

    return;
  });
