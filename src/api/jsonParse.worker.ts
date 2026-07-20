type JsonParseRequest = {
  id: number
  text: string
}

globalThis.addEventListener('message', (event: MessageEvent<JsonParseRequest>) => {
  const { id, text } = event.data
  try {
    globalThis.postMessage({ id, value: JSON.parse(text) })
  } catch (error) {
    globalThis.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

export {}
