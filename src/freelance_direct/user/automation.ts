import * as functions from "firebase-functions";
import { converter, db, location, runtime, storage } from "../../_firebase";
import { algolia } from "../../_algolia";
import { send } from "../../_sendgrid";
import * as body from "../mail";
import * as Firestore from "../../types/firestore";
import { log } from "../../_utils";

export const createUser = functions
  .region(location)
  .runWith(runtime)
  .firestore.document("persons/{uid}")
  .onCreate(async (snapshot) => {
    const profile: Firestore.Person["profile"] = snapshot.data().profile;
    const url: string = functions.config().app.freelance_direct.url;
    const adminUrl: string = functions.config().admin.url;

    const adminMail = {
      to: functions.config().admin.freelance_direct as string,
      from: `Freelance Direct <${functions.config().admin.freelance_direct}>`,
      subject: "【承認】承認待ちメンバー",
      text: body.create.admin(profile, adminUrl),
    };

    const userMail = {
      to: profile.email,
      from: `Freelance Direct <${functions.config().admin.freelance_direct}>`,
      subject: "Freelance Direct 登録確認のお知らせ",
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
    const index = algolia.initIndex("persons");

    const doc = await db
      .collection("persons")
      .withConverter(converter<Firestore.Person>())
      .doc(uid)
      .get();

    const key = doc.data()?.resume.key;

    const name = `${key}.pdf`;
    const bucket = storage.bucket(functions.config().storage.resume);
    const path = bucket.file(name);

    await db.collection("persons").doc(uid).delete();

    await updateFirestore(uid);
    await updateCollectionGroup(uid);

    await index.deleteObject(uid);

    if (key) {
      await path.delete();
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
  .firestore.document("persons/{uid}")
  .onUpdate(async (change) => {
    const profile: Firestore.Person["profile"] = change.after.data().profile;
    const beforeStatus: string = change.before.data().status;
    const afterStatus: string = change.after.data().status;
    const url = `${functions.config().app.freelance_direct.url}/login`;

    if (beforeStatus === "hold" && afterStatus === "enable") {
      const userMail = {
        to: change.after.data().profile.email,
        from: `Freelance Direct <${functions.config().admin.freelance_direct}>`,
        subject: "Freelance Direct 承認完了のお知らせ",
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
  .firestore.document("persons/{uid}")
  .onUpdate(async (change) => {
    const profile: Firestore.Person["profile"] = change.after.data().profile;
    const beforeStatus: string = change.before.data().status;
    const afterStatus: string = change.after.data().status;
    const url: string = functions.config().app.freelance_direct.url;

    if (beforeStatus === "hold" && afterStatus === "disable") {
      const userMail = {
        to: profile.email,
        from: `Freelance Direct <${functions.config().admin.freelance_direct}>`,
        subject: "Freelance Direct 承認結果のお知らせ",
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
  .firestore.document("persons/{uid}")
  .onUpdate(async (change) => {
    const profile: Firestore.Person["profile"] = change.after.data().profile;
    const beforeStatus: string = change.before.data().status;
    const afterStatus: string = change.after.data().status;
    const url: string = functions.config().app.freelance_direct.url;

    if (beforeStatus === "enable" && afterStatus === "disable") {
      const userMail = {
        to: profile.email,
        from: `Freelance Direct <${functions.config().admin.freelance_direct}>`,
        subject: "Freelance Direct 利用停止のお知らせ",
        text: body.disable.user(profile, url),
      };

      await send(userMail);

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
  .firestore.document("persons/{uid}")
  .onUpdate(async (change) => {
    const profile: Firestore.Person["profile"] = change.after.data().profile;
    const beforeStatus: string = change.before.data().status;
    const afterStatus: string = change.after.data().status;
    const url: string = `${functions.config().app.freelance_direct.url}/login`;

    if (beforeStatus === "disable" && afterStatus === "enable") {
      const userMail = {
        to: profile.email,
        from: `Freelance Direct <${functions.config().admin.freelance_direct}>`,
        subject: "Freelance Direct 利用再開のお知らせ",
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
  const collections = ["likes", "follows", "entries", "histories", "requests"];

  for (const collection of collections) {
    const querySnapshot = await db
      .collection("persons")
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

const updateCollectionGroup = async (uid: string) => {
  const collections = ["likes", "entries", "histories"];

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
            collection === "entries"
              ? { active: false, status: "disable", updateAt: timestamp }
              : { active: false, updateAt: timestamp },
            { merge: true }
          )
          .catch(() => {});
      }
    });
  }
};
