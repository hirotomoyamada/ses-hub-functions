import * as Firestore from "../../types/firestore";

export const user = (
  user: Firestore.Company["profile"],
  url: string
): string => {
  return `
${user.name} ${user.person} 様

グループアカウントの申請を承認いたしました。

グループプランはこちらから
${url}
`;
};
