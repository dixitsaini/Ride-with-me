import * as http from "http";
import * as https from "https";

/**
 * `@firebase/rules-unit-testing` talks to the emulators through node-fetch,
 * which reuses Node's global agents. Node 19+ keeps those sockets alive after
 * the response, so Jest reports an open TCP handle and never exits — turning
 * `npm run test:rules` into a hang followed by a SIGTERM failure.
 */
type ReusableAgent = {
  keepAlive?: boolean;
  destroy?: () => void;
};

const globalAgents: ReusableAgent[] = [
  http.globalAgent as unknown as ReusableAgent,
  https.globalAgent as unknown as ReusableAgent,
];

globalAgents.forEach((agent) => {
  agent.keepAlive = false;
});

afterAll(() => {
  globalAgents.forEach((agent) => {
    agent.destroy?.();
  });
});
