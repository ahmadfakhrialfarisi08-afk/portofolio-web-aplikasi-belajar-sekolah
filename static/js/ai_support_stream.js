// ----------------------------------------------------
// CONTOH pemakaian endpoint streaming /api/gemini/chat/stream
// ----------------------------------------------------
// Ini contoh generik -- sesuaikan selector elemen (querySelector dll)
// sama struktur HTML widget AI Support kamu yang sebenarnya.

/**
 * Kirim pertanyaan ke Gemini lewat SSE, panggil callback tiap ada
 * potongan teks baru datang (efek ngetik otomatis kebentuk dari sini,
 * karena browser terima teksnya sepotong-sepotong secara real-time).
 *
 * @param {string} pesan - pertanyaan user
 * @param {(potongan: string) => void} onDelta - dipanggil tiap ada teks baru
 * @param {() => void} onDone - dipanggil kalau jawaban sudah selesai lengkap
 * @param {(pesanError: string) => void} onError - dipanggil kalau gagal
 */
async function kirimPesanKeAISupportStream(pesan, onDelta, onDone, onError) {
  let response;
  try {
    response = await fetch("/api/gemini/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pesan }),
    });
  } catch (err) {
    onError("Tidak bisa menghubungi server. Cek koneksi internet.");
    return;
  }

  if (!response.ok || !response.body) {
    onError("Server AI Support sedang bermasalah, coba lagi sebentar.");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { value, done: streamSelesai } = await reader.read();
      if (streamSelesai) break;

      buffer += decoder.decode(value, { stream: true });

      // Event SSE dipisahkan oleh baris kosong ("\n\n"). Bisa saja satu
      // chunk dari network berisi beberapa event sekaligus, atau satu
      // event terpotong jadi beberapa chunk -- makanya perlu buffer.
      let batasEvent;
      while ((batasEvent = buffer.indexOf("\n\n")) !== -1) {
        const eventMentah = buffer.slice(0, batasEvent);
        buffer = buffer.slice(batasEvent + 2);

        if (!eventMentah.startsWith("data: ")) continue;

        let payload;
        try {
          payload = JSON.parse(eventMentah.slice("data: ".length));
        } catch (e) {
          continue; // event tidak valid, lewati
        }

        if (payload.error) {
          onError(payload.error);
          return;
        }
        if (payload.delta) {
          onDelta(payload.delta);
        }
        if (payload.done) {
          onDone();
          return;
        }
      }
    }
    onDone();
  } catch (err) {
    onError("Koneksi terputus di tengah jalan, coba lagi.");
  }
}

// ----------------------------------------------------
// CONTOH PEMAKAIAN di widget chat (sesuaikan selector-nya)
// ----------------------------------------------------
function contohKirimDariInputUser() {
  const inputEl = document.querySelector("#ai-support-input");
  const daftarChatEl = document.querySelector("#ai-support-messages");

  const pesan = inputEl.value.trim();
  if (!pesan) return;
  inputEl.value = "";

  // Tampilkan bubble pesan user
  const bubbleUser = document.createElement("div");
  bubbleUser.className = "chat-bubble chat-bubble--user";
  bubbleUser.textContent = pesan;
  daftarChatEl.appendChild(bubbleUser);

  // Siapkan bubble kosong buat jawaban AI, nanti diisi sedikit-sedikit
  const bubbleAI = document.createElement("div");
  bubbleAI.className = "chat-bubble chat-bubble--ai";
  bubbleAI.textContent = "";
  daftarChatEl.appendChild(bubbleAI);

  kirimPesanKeAISupportStream(
    pesan,
    (potongan) => {
      // Setiap potongan teks baru langsung ditempel -- inilah efek
      // "ngetik" real-time-nya, tanpa perlu setTimeout/animasi buatan.
      bubbleAI.textContent += potongan;
      daftarChatEl.scrollTop = daftarChatEl.scrollHeight;
    },
    () => {
      // Selesai, tidak perlu ngapa-ngapain khusus -- teksnya sudah
      // lengkap ter-render dari onDelta di atas.
    },
    (pesanError) => {
      bubbleAI.textContent = pesanError;
      bubbleAI.classList.add("chat-bubble--error");
    }
  );
}
