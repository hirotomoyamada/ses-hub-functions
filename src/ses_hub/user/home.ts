import * as functions from "firebase-functions";
import { converter, db, location, runtime } from "../../_firebase";
import { userAuthenticated } from "./_userAuthenticated";
import * as Firestore from "../../types/firestore";
import { log } from "../../_utils";

export const updateHome = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: string[], context) => {
    await userAuthenticated({
      context,
      demo: true,
      canceled: true,
    });

    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "認証されていないユーザーではログインできません",
        "auth"
      );
    }

    const collection = db
      .collection("companys")
      .doc(context.auth.uid)
      .collection("follows")
      .withConverter(converter<Firestore.User>());

    const querySnapshot = await collection.get().catch(() => {
      throw new functions.https.HttpsError(
        "not-found",
        "コレクションの取得に失敗しました",
        "firebase"
      );
    });

    querySnapshot.forEach(async (doc) => {
      if (data.slice(0, 15).indexOf(doc.id) >= 0) {
        await doc.ref.set({ home: true }, { merge: true }).catch(() => {
          throw new functions.https.HttpsError(
            "data-loss",
            "データの追加に失敗しました",
            "firebase"
          );
        });
      } else {
        await doc.ref.set({ home: false }, { merge: true }).catch(() => {
          throw new functions.https.HttpsError(
            "data-loss",
            "データの削除に失敗しました",
            "firebase"
          );
        });
      }
    });

    await log({
      auth: { collection: "companys", doc: context.auth?.uid },
      run: "updateHome",
      index: "companys",
      code: 200,
      uid: data,
    });

    return;
  });
