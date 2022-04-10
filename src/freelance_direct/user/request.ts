import * as functions from "firebase-functions";
import { db, location, runtime, converter } from "../../_firebase";
import * as Firestore from "../../types/firestore";
import { send } from "../../_sendgrid";
import * as body from "../mail";
import { userAuthenticated } from "./_userAuthenticated";
import { PartiallyPartial } from "../../types/utils";

export const enableRequest = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: string, context) => {
    await userAuthenticated({ context, demo: true });

    const { user, selectUser } = await updateFirestore({
      context,
      data,
      status: "enable",
    });

    await sendMail(context, user, selectUser);

    return;
  });

export const disableRequest = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: string, context) => {
    await userAuthenticated({ context, demo: true });

    await updateFirestore({ context, data, status: "disable" });

    return;
  });

const sendMail = async (
  context: functions.https.CallableContext,
  user: Firestore.Person,
  selectUser: Firestore.Company
): Promise<void> => {
  if (!user.profile.nickName) {
    throw new functions.https.HttpsError(
      "cancelled",
      "ニックネームが登録されていないため、処理中止",
      "firebase"
    );
  }
  const url = `${functions.config().app.ses_hub.url}/persons/${
    context.auth?.uid
  }`;

  const mail = {
    to: selectUser.profile.email,
    from: `SES_HUB <${functions.config().admin.ses_hub}>`,
    subject: `【リクエスト】${user.profile.nickName}さんが承認しました`,
    text: body.request.user({
      user: selectUser.profile,
      nickName: user.profile.nickName,
      url: url,
    }),
  };

  await send(mail);
};

const updateFirestore = async ({
  context,
  data,
  status,
}: {
  context: functions.https.CallableContext;
  data: string;
  status: "enable" | "disable";
}): Promise<{ user: Firestore.Person; selectUser: Firestore.Company }> => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証されていないユーザーではログインできません",
      "auth"
    );
  }

  const user: PartiallyPartial<Firestore.Person, "uid"> = {
    uid: context.auth.uid,
  };
  const selectUser: PartiallyPartial<Firestore.Company, "uid"> = {
    uid: data,
  };

  const timestamp = Date.now();

  for await (const index of ["persons", "companys"]) {
    const person = index === "persons";

    const collection = db
      .collection(index)
      .doc(person ? user.uid : selectUser.uid)
      .withConverter(converter<Firestore.Company | Firestore.Person>());

    const subCollection = collection
      .collection(person ? "requests" : "entries")
      .withConverter(converter<Firestore.User>());

    const querySnapshot = await subCollection
      .where("uid", "==", person ? selectUser.uid : user.uid)
      .get()
      .catch(() => {
        throw new functions.https.HttpsError(
          "not-found",
          "コレクションの取得に失敗しました",
          "firebase"
        );
      });

    if (querySnapshot.docs[0]) {
      const doc = querySnapshot.docs[0];

      await doc.ref
        .set(
          {
            uid: person ? user.uid : selectUser.uid,
            status: status,
            updateAt: timestamp,
          },
          { merge: true }
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
        "data-loss",
        "リクエストが存在していません",
        "firebase"
      );
    }

    const doc = await collection.get().catch(() => {
      throw new functions.https.HttpsError(
        "not-found",
        "データの取得に失敗しました",
        "firebase"
      );
    });

    if (!person) {
      const data = doc.data();

      if (
        data &&
        "payment" in data &&
        (data.payment.status === "canceled" ||
          !data.payment.option?.freelanceDirect)
      ) {
        throw new functions.https.HttpsError(
          "cancelled",
          "相手がオプション未加入のユーザーのためリクエストが承認できません",
          "firebase"
        );
      }
    }

    Object.assign(person ? user : selectUser, doc.data());
  }

  return {
    user: user as Firestore.Person,
    selectUser: selectUser as Firestore.Company,
  };
};
