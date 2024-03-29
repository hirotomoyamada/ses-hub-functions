import * as functions from "firebase-functions";
import { converter, db, location, runtime } from "../../_firebase";
import { userAuthenticated } from "./_userAuthenticated";
import { send } from "../../_sendgrid";
import * as body from "../mail";
import * as Firestore from "../../types/firestore";
import { PartiallyPartial } from "../../types/utils";
import { log } from "../../_utils";

type Data = {
  uid: string;
  body: string;
};

export const addRequest = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await userAuthenticated({
      context,
      demo: true,
      index: "persons",
    });

    const { user, selectUser } = await updateFirestore(context, data);

    await sendMail(user, selectUser, data.body);

    await log({
      auth: { collection: "companys", doc: context.auth?.uid },
      run: "addRequest",
      index: "persons",
      code: 200,
      uid: data.uid,
    });
    return;
  });

const sendMail = async (
  user: Firestore.Company,
  selectUser: Firestore.Person,
  text: string
): Promise<void> => {
  const url = {
    user: `${functions.config().app.ses_hub.url}/persons/${selectUser.uid}`,
    selectUser: `${functions.config().app.freelance_direct.url}/user/${
      user.uid
    }`,
  };

  const mail = {
    user: {
      to: user.profile.email,
      from: `SES_HUB <${functions.config().admin.ses_hub}>`,
      subject: "【リクエスト】確認メール",
      text: body.request.user({
        user: user.profile,
        body: text,
        url: url.user,
      }),
    },

    selectUser: {
      to: selectUser.profile.email,
      from: `Freelance Direct <${functions.config().admin.freelance_direct}>`,
      subject: `【リクエスト】${user.profile.name} ${user.profile.person}さんから、リクエストがありました`,
      text: body.request.selectUser({
        user: selectUser.profile,
        body: text,
        url: url.selectUser,
      }),
    },
  };

  await send(mail.user);
  await send(mail.selectUser);
};

const updateFirestore = async (
  context: functions.https.CallableContext,
  data: Data
): Promise<{
  user: Firestore.Company;
  selectUser: Firestore.Person;
}> => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証されていないユーザーではログインできません",
      "auth"
    );
  }

  const user: PartiallyPartial<Firestore.Company, "uid"> = {
    uid: context.auth.uid,
  };
  const selectUser: PartiallyPartial<Firestore.Person, "uid"> = {
    uid: data.uid,
  };

  const timestamp = Date.now();

  await Promise.allSettled(
    ["persons", "companys"].map(async (index) => {
      const person = index === "persons";

      const ref = db
        .collection(index)
        .doc(person ? selectUser.uid : user.uid)
        .withConverter(converter<Firestore.Company | Firestore.Person>());

      const doc = await ref.get().catch(() => {
        throw new functions.https.HttpsError(
          "not-found",
          "データの取得に失敗しました",
          "firebase"
        );
      });

      const subCollection = ref
        .collection(person ? "requests" : "entries")
        .withConverter(converter<Firestore.User>());

      const querySnapshot = await subCollection
        .where("uid", "==", person ? user.uid : selectUser.uid)
        .get()
        .catch(() => {
          throw new functions.https.HttpsError(
            "not-found",
            "コレクションの取得に失敗しました",
            "firebase"
          );
        });

      if (!querySnapshot.docs[0]) {
        const data = doc.data();

        const type = data && "payment" in data ? data.type : null;
        const payment = data && "payment" in data ? data.payment.status : null;

        await subCollection
          .add({
            index: person ? "companys" : "persons",
            uid: person ? user.uid : selectUser.uid,
            status: "hold",
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
      } else {
        throw new functions.https.HttpsError(
          "data-loss",
          "すでにリクエスト済みのため、処理中止",
          "firebase"
        );
      }

      Object.assign(person ? selectUser : user, doc.data());
    })
  );

  return {
    user: user as Firestore.Company,
    selectUser: selectUser as Firestore.Person,
  };
};
