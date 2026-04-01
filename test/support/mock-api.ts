export interface MockApiServer {
  url: URL;
  requests: any[];
  stop(): void;
}

export function createMockApiServer(
  fetchHandler: (request: Request) => Response | Promise<Response>,
): MockApiServer {
  const requests: any[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      requests.push(request.clone());
      return await fetchHandler(request);
    },
  });

  return {
    url: new URL(server.url),
    requests,
    stop: () => server.stop(),
  };
}
