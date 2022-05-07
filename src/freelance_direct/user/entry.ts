import * as functions from "firebase-functions";
import { converter, db, location, runtime } from "../../_firebase";
import * as Firestore from "../../types/firestore";
import { userAuthenticated } from "./_userAuthenticated";
import { log } from "../../_utils";

type Data = { objectID: string; uid: string };

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

    const collection = db
      .collection("persons")
      .doc(context.auth.uid)
      .collection("entries")
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

    if (!doc) {
      await collection
        .add({
          index: "matters",
          uid: data.uid,
          objectID: data.objectID,
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

    await log({
      auth: { collection: "persons", doc: context.auth?.uid },
      run: "addEntry",
      index: "matters",
      code: 200,
      objectID: data.objectID,
    });

    return;
  });
