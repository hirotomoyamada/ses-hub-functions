import * as functions from "firebase-functions";
import algoliasearch from "algoliasearch";

export const algolia = algoliasearch(
  functions.config().algolia.application_id,
  functions.config().algolia.admin_api_key
);
export { SearchOptions, ObjectWithObjectID } from "@algolia/client-search";
export { RequestOptions } from "@algolia/transporter";
