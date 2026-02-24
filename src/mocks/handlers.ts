// src/mocks/handlers.ts
import { http, HttpResponse } from "msw";
import { xdr } from "@stellar/stellar-sdk";

const defaultRetval = xdr.ScVal.scvString("ok").toXDR("base64");

export const handlers = [
  http.get<{ accountId: string }>(
    "https://horizon-testnet.stellar.org/accounts/:accountId",
    ({ params }) => {
      return HttpResponse.json(
        {
          id: params.accountId,
          account_id: params.accountId,
          balances: [{ asset_type: "native", balance: "1000.0000000" }],
        },
        { status: 200 }
      );
    }
  ),
  http.post("https://soroban-testnet.stellar.org", async ({ request }) => {
    const body = (await request.json()) as {
      id?: string | number;
      method?: string;
      params?: Record<string, unknown>;
    };

    const rpcId = body.id ?? 1;

    if (body.method === "simulateTransaction") {
      return HttpResponse.json(
        {
          jsonrpc: "2.0",
          id: rpcId,
          result: {
            latestLedger: 12345,
            minResourceFee: "100",
            transactionData: "AAAAAQAAAAA=",
            results: [],
            result: {
              auth: [],
              retval: defaultRetval,
            },
          },
        },
        { status: 200 }
      );
    }

    if (body.method === "sendTransaction") {
      return HttpResponse.json(
        {
          jsonrpc: "2.0",
          id: rpcId,
          result: {
            status: "PENDING",
            hash: "test-tx-hash",
          },
        },
        { status: 200 }
      );
    }

    return HttpResponse.json(
      {
        jsonrpc: "2.0",
        id: rpcId,
        error: {
          code: -32601,
          message: `Unsupported RPC method: ${String(body.method)}`,
        },
      },
      { status: 400 }
    );
  }),
];
