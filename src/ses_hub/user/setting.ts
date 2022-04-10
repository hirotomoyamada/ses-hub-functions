import * as functions from "firebase-functions";
import { db, location, runtime, converter } from "../../_firebase";
import { userAuthenticated } from "./_userAuthenticated";
import * as Firestore from "../../types/firestore";

type Data = {
  type: "activity";
  setting: Firestore.Company["setting"]["activity"];
};

export const updateSetting = functions
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

    const doc = await db
      .collection("companys")
      .doc(context.auth.uid)
      .withConverter(converter<Firestore.Company>())
      .get()
      .catch(() => {
        throw new functions.https.HttpsError(
          "not-found",
          "ユーザーの取得に失敗しました",
          "firebase"
        );
      });

    if (doc.exists) {
      await doc.ref
        .set(
          { setting: { [data.type]: data.setting }, updateAt: timestamp },
          {
            merge: true,
          }
        )
        .catch(() => {
          throw new functions.https.HttpsError(
            "data-loss",
            "データの追加に失敗しました",
            "firebase"
          );
        });
    } else {
      throw new functions.https.HttpsError(
        "not-found",
        "ユーザーの取得に失敗しました",
        "firebase"
      );
    }

    return;
  });
