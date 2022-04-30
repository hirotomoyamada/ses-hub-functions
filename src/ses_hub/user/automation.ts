import * as functions from "firebase-functions";
import { converter, db, location, runtime } from "../../_firebase";
import { algolia } from "../../_algolia";
import { send } from "../../_sendgrid";
import * as body from "../mail";
import * as Firestore from "../../types/firestore";
import { log } from "../../_utils";

export const createUser = functions
  .region(location)
  .runWith(runtime)
  .firestore.document("companys/{uid}")
  .onCreate(async (snapshot) => {
    const child = snapshot.data().type === "child";
    const profile: Firestore.Company["profile"] = snapshot.data().profile;

    const url: string = functions.config().app.ses_hub.url;
    const adminUrl: string = functions.config().admin.url;

    if (child) {
      throw new functions.https.HttpsError(
        "cancelled",
        "子アカウントのため、処理中止",
        "firebase"
      );
    }

    const adminMail = {
      to: functions.config().admin.ses_hub as string,
      from: `SES_HUB <${functions.config().admin.ses_hub}>`,
      subject: "【承認】承認待ちメンバー",
      text: body.create.admin(profile, adminUrl),
    };

    const userMail = {
      to: profile.email,
      from: `SES_HUB <${functions.config().admin.ses_hub}>`,
      subject: "SES_HUB 登録確認のお知らせ",
      text: body.create.user(profile, url),
    };

    await send(adminMail);
    await send(userMail);

    await log({
      doc: snapshot.id,
      run: "createUser",
      code: 200,
    });
  });

export const deleteUser = functions
  .region(location)
  .runWith(runtime)
  .auth.user()
  .onDelete(async (snapshot) => {
    const uid = snapshot.uid;

    const doc = await db
      .collection("companys")
      .withConverter(converter<Firestore.Company>())
      .doc(uid)
      .get();

    if (doc.exists) {
      const child = doc.data()?.type === "child";
      const parent = doc.data()?.payment.parent;

      await db.collection("companys").doc(uid).delete();
      await db.collection("customers").doc(uid).delete();

      await updateFirestore(uid);
      await updateCollectionGroup(uid);
      await deleteAlgolia(uid);

      child && parent && (await deleteChild({ child: uid, parent: parent }));
    }

    await log({
      doc: snapshot.uid,
      run: "deleteUser",
      code: 200,
    });

    return;
  });

export const enableUser = functions
  .region(location)
  .runWith(runtime)
  .firestore.document("companys/{uid}")
  .onUpdate(async (change) => {
    const profile: Firestore.Company["profile"] = change.after.data().profile;
    const beforeStatus: string = change.before.data().status;
    const afterStatus: string = change.after.data().status;
    const url = `${functions.config().app.ses_hub.url}/login`;

    if (beforeStatus !== "hold") {
      return;
    }

    if (beforeStatus === "hold" && afterStatus === "enable") {
      const userMail = {
        to: profile.email,
        from: `SES_HUB <${functions.config().admin.ses_hub}>`,
        subject: "SES_HUB 承認完了のお知らせ",
        text: body.enable.user(profile, url),
      };

      await send(userMail);

      await log({
        doc: change.before.id,
        run: "enableUser",
        code: 200,
      });
    }
  });

export const declineUser = functions
  .region(location)
  .runWith(runtime)
  .firestore.document("companys/{uid}")
  .onUpdate(async (change) => {
    const profile: Firestore.Company["profile"] = change.after.data().profile;
    const beforeStatus: string = change.before.data().status;
    const afterStatus: string = change.after.data().status;
    const url: string = functions.config().app.ses_hub.url;

    if (beforeStatus === "hold" && afterStatus === "disable") {
      const userMail = {
        to: profile.email,
        from: `SES_HUB <${functions.config().admin.ses_hub}>`,
        subject: "SES_HUB 承認結果のお知らせ",
        text: body.decline.user(profile, url),
      };

      await send(userMail);

      await log({
        doc: change.before.id,
        run: "declineUser",
        code: 200,
      });
    }
  });

export const disableUser = functions
  .region(location)
  .runWith(runtime)
  .firestore.document("companys/{uid}")
  .onUpdate(async (change) => {
    const profile: Firestore.Company["profile"] = change.after.data().profile;
    const beforeStatus: string = change.before.data().status;
    const afterStatus: string = change.after.data().status;
    const url: string = functions.config().app.ses_hub.url;

    const userMail = {
      to: change.after.data().profile.email as string,
      from: `SES_HUB <${functions.config().admin.ses_hub}>`,
      subject: "SES_HUB 利用停止のお知らせ",
      text: body.disable.user(profile, url),
    };

    if (beforeStatus === "enable" && afterStatus === "disable") {
      await send(userMail);

      const posts: {
        matters: string[];
        resources: string[];
      } = change.before.data().posts;

      if (posts.matters.length) {
        const index = algolia.initIndex("matters");
        const matters = posts.matters.map((objectID) => ({
          objectID: objectID,
          display: "private",
        }));

        await index.partialUpdateObjects(matters);
      }

      if (posts.resources.length) {
        const index = algolia.initIndex("resources");
        const resources = posts.resources.map((objectID) => ({
          objectID: objectID,
          display: "private",
        }));

        await index.partialUpdateObjects(resources);
      }

      await log({
        doc: change.before.id,
        run: "disableUser",
        code: 200,
      });
    }
  });

export const goBackUser = functions
  .region(location)
  .runWith(runtime)
  .firestore.document("companys/{uid}")
  .onUpdate(async (change) => {
    const profile: Firestore.Company["profile"] = change.after.data().profile;
    const beforeStatus: string = change.before.data().status;
    const afterStatus: string = change.after.data().status;
    const url = `${functions.config().app.ses_hub.url}/login`;

    if (beforeStatus === "disable" && afterStatus === "enable") {
      const userMail = {
        to: profile.email,
        from: `SES_HUB <${functions.config().admin.ses_hub}>`,
        subject: "SES_HUB 利用再開のお知らせ",
        text: body.goBack.user(profile, url),
      };

      await send(userMail);

      await log({
        doc: change.before.id,
        run: "goBackUser",
        code: 200,
      });
    }
  });

const updateFirestore = async (uid: string) => {
  const collections = [
    "posts",
    "likes",
    "outputs",
    "follows",
    "entries",
    "histories",
  ];

  for (const collection of collections) {
    const querySnapshot = await db
      .collection("companys")
      .doc(uid)
      .collection(collection)
      .withConverter(converter<Firestore.Post | Firestore.User>())
      .where("active", "==", true)
      .get()
      .catch(() => {
        throw new functions.https.HttpsError(
          "not-found",
          "コレクションの取得に失敗しました",
          "firebase"
        );
      });

    const timestamp = Date.now();

    querySnapshot.forEach(async (doc) => {
      if (doc) {
        await doc.ref
          .set(
            collection === "posts"
              ? { active: false, display: "private", deleteAt: timestamp }
              : collection === "follows"
              ? { active: false, home: false, updateAt: timestamp }
              : collection === "entries" && doc.data().index === "persons"
              ? { active: false, status: "disable", updateAt: timestamp }
              : { active: false, updateAt: timestamp },
            { merge: true }
          )
          .catch(() => {});
      }
    });
  }
};

const updateCollectionGroup = async (uid: string) => {
  const collections = [
    "likes",
    "outputs",
    "follows",
    "entries",
    "histories",
    "requests",
  ];

  for (const collection of collections) {
    const querySnapshot = await db
      .collectionGroup(collection)
      .withConverter(converter<Firestore.Post | Firestore.User>())
      .where("uid", "==", uid)
      .orderBy("createAt", "desc")
      .get()
      .catch(() => {});

    const timestamp = Date.now();

    if (!querySnapshot) {
      continue;
    }

    querySnapshot.forEach(async (doc) => {
      if (doc) {
        await doc.ref
          .set(
            collection === "follows"
              ? { active: false, home: false, updateAt: timestamp }
              : collection === "requests"
              ? { active: false, status: "disable", updateAt: timestamp }
              : { active: false, updateAt: timestamp },
            { merge: true }
          )
          .catch(() => {});
      }
    });
  }
};

const deleteAlgolia = async (uid: string) => {
  for (const i of ["companys", "matters", "resources"]) {
    const index = algolia.initIndex(i);

    if (i === "companys") {
      await index.deleteObject(uid);
    } else {
      const querySnapshot = await db
        .collection("companys")
        .doc(uid)
        .collection("posts")
        .withConverter(converter<Firestore.Post>())
        .where("index", "==", i)
        .get()
        .catch(() => {
          throw new functions.https.HttpsError(
            "not-found",
            "コレクションの取得に失敗しました",
            "firebase"
          );
        });

      const posts = querySnapshot.docs.map((doc) => doc.data().objectID);

      if (posts.length) {
        await index.deleteObjects(posts);
      }
    }
  }
};

const deleteChild = async ({
  child,
  parent,
}: {
  child: string;
  parent: string;
}) => {
  const doc = await db
    .collection("companys")
    .withConverter(converter<Firestore.Company>())
    .doc(parent)
    .get();

  if (doc.exists) {
    const payment = doc.data()?.payment;

    if (payment) {
      const children = payment.children?.filter((uid) => uid !== child);

      await doc.ref
        .set(
          { payment: Object.assign(payment, { children: children }) },
          { merge: true }
        )
        .catch(() => {});
    }
  }

  return;
};
