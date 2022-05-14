import * as functions from "firebase-functions";
import {
  company,
  lastNickName,
  firstNickName,
  lastName,
  firstName,
  email,
  urls,
} from "./_dummy";
import { db, converter } from "./_firebase";
import * as Firestore from "./types/firestore";
import { randomBytes } from "crypto";

export type Log = ({
  index,
  run,
  code,
  uid,
  objectID,
  message,
}: {
  auth: { collection: "companys" | "persons"; doc?: string };
} & Omit<Firestore.Log, "type" | "payment" | "createAt">) => Promise<void>;

export const log: Log = async ({
  auth,
  index,
  run,
  code,
  objectID,
  uid,
  message,
}) => {
  if (!auth.doc) return;

  const createAt = Date.now();

  const ref = db
    .collection(auth.collection)
    .doc(auth.doc)
    .withConverter(converter<Firestore.Company | Firestore.Person>());

  const doc = await ref.get().catch(() => {
    throw new functions.https.HttpsError(
      "data-loss",
      "データの更新に失敗しました",
      "firebase"
    );
  });

  const data = doc.data();

  const type = data && "payment" in data ? data.type : null;
  const payment = data && "payment" in data ? data.payment.status : null;

  const collection = ref
    .collection("logs")
    .withConverter(converter<Firestore.Log>());

  if (run === "login") {
    const querySnapshot = await collection
      .where("run", "==", "login")
      .orderBy("createAt", "desc")
      .get()
      .catch(() => {});

    if (querySnapshot) {
      const doc = querySnapshot.docs[0];
      const lastLog = doc?.data()?.createAt;

      if (lastLog && lastLog + 60 * 60 * 1 * 1000 > createAt) {
        return;
      }
    }
  }

  await collection
    .add({
      ...{
        run,
        code,
        createAt,
        type,
        payment,
      },
      ...(index ? { index } : {}),
      ...(uid ? { uid } : {}),
      ...(objectID ? { objectID } : {}),
      ...(message ? { message } : {}),
    })
    .catch(() => {
      throw new functions.https.HttpsError(
        "data-loss",
        "データの追加に失敗しました",
        "firebase"
      );
    });

  return;
};

export type Time = (t: "day" | "week" | "month") => {
  start: number;
  end: number;
};

export const time: Time = (t = "day") => {
  const timeZone = 60 * 60 * 9 * 1000;

  const end = new Date().setHours(23, 59, 59, 999) - timeZone;

  switch (t) {
    case "month": {
      const start = new Date(new Date().setDate(1)).setHours(0, 0, 0, 0);

      return { start, end };
    }
    case "week": {
      let timestamp = new Date();

      while (true) {
        if (timestamp.getDay() == 1) break;
        timestamp = new Date(
          timestamp.getFullYear(),
          timestamp.getMonth(),
          timestamp.getDate() - 1
        );
      }

      const start = timestamp.getTime() - timeZone;

      return { start, end };
    }
    default: {
      const start = new Date().setHours(0, 0, 0, 0);

      return { start, end };
    }
  }
};

export type Dummy = {
  index: () => "companys" | "persons";
  uid: () => string;
  icon: (i: string) => string;
  name: () => string;
  person: () => string;
  nickName: () => string;
  email: () => string;
  urls: (i: number) => string[];
  num: (min: number, max?: number) => number;
  at: (t?: "day" | "week" | "month") => number;
};

export const dummy: Dummy = {
  index: (): "companys" | "persons" =>
    ["companys", "persons"][Math.floor(Math.random() * 2)] as
      | "companys"
      | "persons",
  uid: () => {
    const S = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const N = 28;
    return Array.from(randomBytes(N))
      .map((n) => S[n % S.length])
      .join("");
  },
  icon: (i) =>
    i === "companys"
      ? `icon${Math.floor(Math.random() * 17 + 1)}`
      : `icon${Math.floor(Math.random() * (36 - 17 + 1) + 17 + 1)}`,
  name: () => company[Math.floor(Math.random() * company.length)],
  person: () =>
    `${lastName[Math.floor(Math.random() * lastName.length)]}${
      firstName[Math.floor(Math.random() * firstName.length)]
    }`,
  nickName: () =>
    lastNickName[Math.floor(Math.random() * lastNickName.length)] +
    firstNickName[Math.floor(Math.random() * firstNickName.length)],
  email: () => email[Math.floor(Math.random() * email.length)],
  urls: (i) =>
    [...Array(Math.floor(Math.random() * (i ? i : 1) + 1))].map(
      () => [...urls].splice(Math.floor(Math.random() * [...urls].length), 1)[0]
    ),
  num: (min, max) =>
    !max
      ? Math.floor(Math.random() * min + 1)
      : Math.floor(Math.random() * (max - min + 1) + min + 1),
  at: (t = "day") => {
    const now = Date.now();
    const day = 60 * 60 * 24 * 1000;

    switch (t) {
      case "month": {
        const target = now - day * 31;
        return Math.floor(Math.random() * (now - target + 1) + target + 1);
      }
      case "week": {
        const target = now - day * 7;
        return Math.floor(Math.random() * (now - target + 1) + target + 1);
      }
      default: {
        const target = now - day * 1;
        return Math.floor(Math.random() * (now - target + 1) + target + 1);
      }
    }
  },
};
