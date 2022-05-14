import * as functions from "firebase-functions";
import { converter, db, location, runtime } from "../_firebase";
import * as Firestore from "../types/firestore";
import { time as calcTime } from "../_utils";
import { userAuthenticated } from "./_userAuthenticated";

type Data = {
  span: "total" | "day" | "week" | "month";
};

type Collection =
  | "login"
  | "posts"
  | "histories"
  | "likes"
  | "outputs"
  | "entries"
  | "follows";

type Sort = "active" | "trialing" | "canceled" | "person";

type Timestamp = { label: string; time: { start: number; end: number } };

type Activity = {
  key: Collection;
  label: string;
  active?: number;
  trialing?: number;
  canceled?: number;
  person?: number;
  log: {
    label: string;
    active?: number;
    trialing?: number;
    canceled?: number;
    person?: number;
  }[];
};

export const fetchActivity = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await userAuthenticated(context);

    const collections: { collection: Collection; label: string }[] = [
      { collection: "login", label: "ログイン" },
      { collection: "posts", label: "投稿" },
      { collection: "histories", label: "閲覧" },
      { collection: "likes", label: "いいね" },
      { collection: "outputs", label: "出力" },
      { collection: "entries", label: "お問い合わせ" },
      { collection: "follows", label: "フォロー" },
    ];

    const activities: Activity[] = [];

    for (const { collection, label } of collections) {
      const activity: Activity = {
        key: collection,
        label,
        active: undefined,
        trialing: undefined,
        canceled: undefined,
        person: undefined,
        log: [],
      };

      await fetchTotal(activity, collection, data);

      await fetchLog(activity, collection, data);

      activities.push(activity);
    }

    return activities;
  });

const fetchLog = async (
  activity: Activity,
  collection: Collection,
  data: Data
): Promise<void> => {
  const span = data.span;
  const day = span === "day";
  const max = (() => {
    switch (collection) {
      case "login":
        return day ? 14 : 12;

      default:
        return day ? 7 : 6;
    }
  })();

  for (let i = 0; i < max; i++) {
    const { label, time } = timestamp(i, span);

    switch (collection) {
      case "posts":
      case "outputs": {
        const querySnapshot = {
          active: await fetchCollectionGroup({
            collection,
            sort: "active",
            time,
          }),
          trialing: await fetchCollectionGroup({
            collection,
            sort: "trialing",
            time,
          }),
          canceled: await fetchCollectionGroup({
            collection,
            sort: "canceled",
            time,
          }),
        };

        const active = querySnapshot.active
          ? querySnapshot.active.docs.length
          : 0;
        const trialing = querySnapshot.trialing
          ? querySnapshot.trialing.docs.length
          : 0;
        const canceled = querySnapshot.canceled
          ? querySnapshot.canceled.docs.length
          : 0;

        const log: Activity["log"][number] = {
          label,
          active,
          trialing,
          canceled,
          person: undefined,
        };

        activity.log.push(log);

        continue;
      }

      case "login": {
        const querySnapshot = {
          active: await fetchCollectionGroup({
            collection,
            sort: "active",
            time,
          }),
          trialing: await fetchCollectionGroup({
            collection,
            sort: "trialing",
            time,
          }),
          canceled: await fetchCollectionGroup({
            collection,
            sort: "canceled",
            time,
          }),
          person: await fetchCollectionGroup({
            collection,
            sort: "person",
            time,
          }),
        };

        const active = querySnapshot.active
          ? querySnapshot.active.docs.filter(
              (current, i, others) =>
                others.findIndex(
                  (other) => other.data().uid === current.data().uid
                ) === i
            ).length
          : 0;
        const trialing = querySnapshot.trialing
          ? querySnapshot.trialing.docs.filter(
              (current, i, others) =>
                others.findIndex(
                  (other) => other.data().uid === current.data().uid
                ) === i
            ).length
          : 0;
        const canceled = querySnapshot.canceled
          ? querySnapshot.canceled.docs.filter(
              (current, i, others) =>
                others.findIndex(
                  (other) => other.data().uid === current.data().uid
                ) === i
            ).length
          : 0;
        const person = querySnapshot.person
          ? querySnapshot.person.docs.filter(
              (current, i, others) =>
                others.findIndex(
                  (other) => other.data().uid === current.data().uid
                ) === i
            ).length
          : 0;

        const log: Activity["log"][number] = {
          label,
          active,
          trialing,
          canceled,
          person,
        };

        activity.log.push(log);

        continue;
      }

      default: {
        const querySnapshot = {
          active: await fetchCollectionGroup({
            collection,
            sort: "active",
            time,
          }),
          trialing: await fetchCollectionGroup({
            collection,
            sort: "trialing",
            time,
          }),
          canceled: await fetchCollectionGroup({
            collection,
            sort: "canceled",
            time,
          }),
          person: await fetchCollectionGroup({
            collection,
            sort: "person",
            time,
          }),
        };

        const active = querySnapshot.active
          ? querySnapshot.active.docs.length
          : 0;
        const trialing = querySnapshot.trialing
          ? querySnapshot.trialing.docs.length
          : 0;
        const canceled = querySnapshot.canceled
          ? querySnapshot.canceled.docs.length
          : 0;
        const person = querySnapshot.person
          ? querySnapshot.person.docs.length
          : 0;

        const log: Activity["log"][number] = {
          label,
          active,
          trialing,
          canceled,
          person,
        };

        activity.log.push(log);

        continue;
      }
    }
  }
};

const fetchTotal = async (
  activity: Activity,
  collection: Collection,
  data: Data
): Promise<void> => {
  const posts = collection === "posts";
  const outputs = collection === "outputs";

  const sorts: Sort[] = ["active", "trialing", "canceled", "person"];

  await Promise.allSettled(
    sorts.map(async (sort) => {
      if (sort === "person") if (posts || outputs) return;

      const querySnapshot = await fetchCollectionGroup({
        collection,
        sort,
        span: data.span,
      });

      if (!querySnapshot) return;

      const count = (() => {
        switch (collection) {
          case "login":
            return querySnapshot.docs.filter(
              (current, i, others) =>
                others.findIndex(
                  (other) => other.data().uid === current.data().uid
                ) === i
            ).length;

          default:
            return querySnapshot.docs.length;
        }
      })();

      activity[sort] = count;
    })
  );
};

const fetchCollectionGroup = async ({
  collection,
  sort,
  span,
  time,
}: {
  collection: Collection;
  sort: Sort;
  span?: Data["span"];
  time?: Timestamp["time"];
}): Promise<void | FirebaseFirestore.QuerySnapshot<
  Firestore.Post | Firestore.User | Firestore.Log
>> => {
  const collectionGroup = (() => {
    switch (collection) {
      case "login":
        return db.collectionGroup("logs");
      default:
        return db.collectionGroup(collection);
    }
  })();

  switch (collection) {
    case "login": {
      switch (span) {
        case "total": {
          return await collectionGroup
            .withConverter(converter<Firestore.Log>())
            .where("payment", "==", sort !== "person" ? sort : null)
            .where("code", "==", 200)
            .where("run", "==", "login")
            .orderBy("createAt", "desc")
            .get()
            .catch(() => {});
        }

        default: {
          return await collectionGroup
            .withConverter(converter<Firestore.Log>())
            .where("payment", "==", sort !== "person" ? sort : null)
            .where("code", "==", 200)
            .where("run", "==", "login")
            .where(
              "createAt",
              ">=",
              span ? calcTime(span).start : time ? time.start : undefined
            )
            .where(
              "createAt",
              "<=",
              span ? calcTime(span).end : time ? time.end : undefined
            )
            .orderBy("createAt", "desc")
            .get()
            .catch(() => {});
        }
      }
    }

    default: {
      switch (span) {
        case "total": {
          return await collectionGroup
            .withConverter(converter<Firestore.Post | Firestore.User>())
            .where("payment", "==", sort !== "person" ? sort : null)
            .orderBy("createAt", "desc")
            .get()
            .catch(() => {});
        }

        default: {
          return await collectionGroup
            .withConverter(converter<Firestore.Post | Firestore.User>())
            .where("payment", "==", sort !== "person" ? sort : null)
            .where(
              "createAt",
              ">=",
              span ? calcTime(span).start : time ? time.start : undefined
            )
            .where(
              "createAt",
              "<=",
              span ? calcTime(span).end : time ? time.end : undefined
            )
            .orderBy("createAt", "desc")
            .get()
            .catch(() => {});
        }
      }
    }
  }
};

const timestamp = (i: number, span: Data["span"]): Timestamp => {
  const timeZone = 60 * 60 * 9 * 1000;

  switch (span) {
    case "day": {
      const date = new Date(new Date().setHours(0, 0, 0, 0));
      const start = new Date(date.setDate(date.getDate() - i));
      const end = new Date(date.setHours(23, 59, 59, 999));

      const label = (() => {
        switch (i) {
          case 0:
            return `今日`;

          default:
            return `${start.getMonth() + 1}月${start.getDate()}日`;
        }
      })();

      const time = {
        start: start.getTime() - timeZone,
        end: end.getTime() - timeZone,
      };

      return { label, time };
    }

    case "week": {
      const date = new Date(
        new Date(new Date().setDate(new Date().getDate() - i * 7)).setHours(
          0,
          0,
          0,
          0
        )
      );
      const start = new Date(
        date.setDate(
          date.getDate() - (date.getDay() === 0 ? 6 : date.getDay() - 1)
        )
      );
      const end = new Date(
        new Date(date.setDate(start.getDate() + 6)).setHours(23, 59, 59, 999)
      );

      const label = (() => {
        switch (i) {
          case 0:
            return `今週`;

          default:
            return `${i}週間前`;
        }
      })();

      const time = {
        start: start.getTime() - timeZone,
        end: end.getTime() - timeZone,
      };

      return { label, time };
    }

    default: {
      const date = new Date(
        new Date(new Date().setDate(1)).setHours(0, 0, 0, 0)
      );
      const start = new Date(date.setMonth(date.getMonth() - i));
      const end = new Date(
        new Date(
          new Date(date.setMonth(date.getMonth() + 1)).setDate(0)
        ).setHours(23, 59, 59, 999)
      );

      const label = (() => {
        switch (i) {
          case 0:
            return `今月`;

          default:
            return `${date.getMonth()}月`;
        }
      })();

      const time = {
        start: start.getTime() - timeZone,
        end: end.getTime() - timeZone,
      };

      return { label, time };
    }
  }
};
