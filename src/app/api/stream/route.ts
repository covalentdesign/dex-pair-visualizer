import { CHAINS, normalizeChainName } from "@/lib/constants";
import { StreamEvent } from "@/lib/types";

// The SDK requires 'ws' polyfill in Node.js
import WebSocket from "ws";
(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
  WebSocket;

async function getGoldRushClient() {
  const { GoldRushClient } = await import("@covalenthq/client-sdk");
  return new GoldRushClient(
    process.env.GOLDRUSH_API_KEY ?? "",
    {},
    {
      onConnecting: () => console.log("[GoldRush] Connecting..."),
      onOpened: () => console.log("[GoldRush] Connected!"),
      onClosed: () => console.log("[GoldRush] Disconnected"),
      onError: (err: unknown) => console.error("[GoldRush] Error:", err),
    }
  );
}

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let alive = true;

      function send(event: StreamEvent) {
        if (!alive) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          alive = false;
        }
      }

      let client: Awaited<ReturnType<typeof getGoldRushClient>>;
      try {
        client = await getGoldRushClient();
      } catch (err) {
        console.error("[GoldRush] Failed to create client:", err);
        controller.close();
        return;
      }

      const unsubscribers: (() => void)[] = [];
      const discoveredPairs = new Map<string, Set<string>>();
      const updateUnsubs = new Map<string, () => void>();

      for (const chain of CHAINS) {
        discoveredPairs.set(chain.name, new Set());

        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const unsub = (client.StreamingService as any).subscribeToNewPairs(
            {
              chain_name: chain.name,
              protocols: chain.protocols,
            },
            {
              // The SDK callback receives an array of NewPairsStreamResponse
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              next: (dataArr: any) => {
                const items = Array.isArray(dataArr) ? dataArr : [dataArr];
                for (const data of items) {
                  if (!data || !data.pair_address) continue;

                  const chainName = normalizeChainName(
                    data.chain_name || chain.name
                  );
                  const pairs = discoveredPairs.get(chainName);
                  if (pairs) pairs.add(data.pair_address);

                  const event: StreamEvent = {
                    type: "new-pair",
                    chain: chainName,
                    pairAddress: data.pair_address,
                    baseToken:
                      data.base_token?.contract_name ?? "Unknown",
                    quoteToken:
                      data.quote_token?.contract_name ?? "Unknown",
                    baseTicker:
                      data.base_token?.contract_ticker_symbol ?? "?",
                    quoteTicker:
                      data.quote_token?.contract_ticker_symbol ?? "?",
                    liquidity: data.liquidity ?? 0,
                    protocol: data.protocol ?? "",
                    timestamp: Date.now(),
                  };
                  send(event);
                }
              },
              error: (error: unknown) => {
                console.error(
                  `[GoldRush] newPairs error for ${chain.name}:`,
                  error
                );
              },
              complete: () => {
                console.log(
                  `[GoldRush] newPairs completed for ${chain.name}`
                );
              },
            }
          );
          if (unsub) unsubscribers.push(unsub);
        } catch (err) {
          console.error(
            `[GoldRush] Failed to subscribe newPairs for ${chain.name}:`,
            err
          );
        }
      }

      // Periodically subscribe to updatePairs for discovered pairs
      const updateInterval = setInterval(() => {
        if (!alive) {
          clearInterval(updateInterval);
          return;
        }

        for (const chain of CHAINS) {
          const pairs = discoveredPairs.get(chain.name);
          if (!pairs || pairs.size === 0) continue;

          const pairAddresses = Array.from(pairs).slice(-50);

          const prevUnsub = updateUnsubs.get(chain.name);
          if (prevUnsub) {
            try {
              prevUnsub();
            } catch {
              /* ignore */
            }
          }

          try {
            const unsub = (
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              client.StreamingService as any
            ).subscribeToUpdatePairs(
              {
                chain_name: chain.name,
                pair_addresses: pairAddresses,
              },
              {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                next: (dataArr: any) => {
                  const items = Array.isArray(dataArr)
                    ? dataArr
                    : [dataArr];
                  for (const data of items) {
                    if (!data || !data.pair_address) continue;

                    const event: StreamEvent = {
                      type: "pair-update",
                      chain: normalizeChainName(
                        data.chain_name || chain.name
                      ),
                      pairAddress: data.pair_address,
                      liquidity: data.liquidity ?? 0,
                      volumeUsd: data.volume_usd ?? 0,
                      timestamp: Date.now(),
                    };
                    send(event);
                  }
                },
                error: (error: unknown) => {
                  console.error(
                    `[GoldRush] updatePairs error for ${chain.name}:`,
                    error
                  );
                },
                complete: () => {},
              }
            );
            if (unsub) updateUnsubs.set(chain.name, unsub);
          } catch (err) {
            console.error(
              `[GoldRush] Failed to subscribe updatePairs for ${chain.name}:`,
              err
            );
          }
        }
      }, 60000);

      // Heartbeat to keep SSE alive
      const heartbeat = setInterval(() => {
        if (!alive) {
          clearInterval(heartbeat);
          clearInterval(updateInterval);
          return;
        }
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          alive = false;
          clearInterval(heartbeat);
          clearInterval(updateInterval);
        }
      }, 15000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
