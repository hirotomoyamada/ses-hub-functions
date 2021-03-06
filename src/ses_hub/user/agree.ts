import * as functions from "firebase-functions";
import { converter, db, location, runtime } from "../../_firebase";
import { userAuthenticated } from "./_userAuthenticated";
import * as Firestore from "../../types/firestore";
import { log } from "../../_utils";

export const enableAgree = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (_data: unknown, context) => {
    await userAuthenticated({
      context,
      demo: true,
      agree: true,
    });

    await updateFiresotre(context);

    await log({
      auth: { collection: "companys", doc: context.auth?.uid },
      run: "enableAgree",
      code: 200,
    });

    return;
  });

export const disableAgree = functions
  .region(location)
  .runWith(runtime)
  .firestore.document("seshub/agree")
  .onUpdate(async (change, context) => {
    const beforeStatus: string = change.before.data().status;
    const afterStatus: string = change.after.data().status;

    if (beforeStatus === "disable" && afterStatus === "enable") {
      await updateFiresotre();
      await updateData();

      await log({
        auth: { collection: "companys", doc: context.auth?.uid },
        run: "disableAgree",
        code: 200,
      });
    }

    return;
  });

const updateFiresotre = async (
  context?: functions.https.CallableContext
): Promise<void> => {
  const timestamp = Date.now();

  if (context?.auth) {
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

    if (!doc.exists) return;

    await doc.ref
      .set(
        {
          agree: "enable",
          updateAt: timestamp,
        },
        { merge: true }
      )
      .catch(() => {
        throw new functions.https.HttpsError(
          "data-loss",
          "プロフィールの更新に失敗しました",
          "firebase"
        );
      });
  } else {
    const querySnapshot = await db
      .collection("companys")
      .withConverter(converter<Firestore.Company>())
      .get()
      .catch(() => {
        throw new functions.https.HttpsError(
          "not-found",
          "ユーザーの取得に失敗しました",
          "firebase"
        );
      });

    querySnapshot?.forEach(async (doc) => {
      await doc.ref
        .set(
          {
            agree: "disable",
          },
          { merge: true }
        )
        .catch(() => {
          throw new functions.https.HttpsError(
            "data-loss",
            "プロフィールの更新に失敗しました",
            "firebase"
          );
        });
    });
  }

  return;
};

const updateData = async (): Promise<void> => {
  const doc = await db
    .collection("seshub")
    .withConverter(converter<Firestore.Data["agree"]>())
    .doc("agree")
    .get()
    .catch(() => {
      throw new functions.https.HttpsError(
        "data-loss",
        "データの更新に失敗しました",
        "firebase"
      );
    });

  await doc.ref.set({ status: "disable" }, { merge: true });

  return;
};
