import { company, lastName, firstName, email, urls } from "./_dummy";

export type Today = {
  start: () => number;
  end: () => number;
};

export const today: Today = {
  start: (): number => new Date().setHours(0, 0, 0, 0),
  end: (): number => new Date().setHours(23, 59, 59, 999),
};

export type Dummy = {
  name: () => string;
  person: () => string;
  email: () => string;
  urls: (i: number) => string[];
};

export const dummy: Dummy = {
  name: (): string => company[Math.floor(Math.random() * company.length)],
  person: (): string =>
    `${lastName[Math.floor(Math.random() * lastName.length)]}${
      firstName[Math.floor(Math.random() * firstName.length)]
    }`,
  email: (): string => email[Math.floor(Math.random() * email.length)],
  urls: (i: number): string[] =>
    [...Array(Math.floor(Math.random() * (i ? i : 1) + 1))].map(
      () => [...urls].splice(Math.floor(Math.random() * [...urls].length), 1)[0]
    ),
};
