/**
 * ==========================================================
 * QUIZ GENERATOR ENGINE (AI-Powered 3 Categories)
 * ==========================================================
 */

const QuizGenerator = {
    async generateSoal(kategori, topikMateri) {
        console.log(`Memproses AI Generator untuk kategori: ${kategori} dengan topik: ${topikMateri}`);
        
        let hasilSoal = [];

        if (kategori === 'pilihan-ganda') {
            hasilSoal = this.generateMockPilihanGanda(topikMateri);
        } else if (kategori === 'essay') {
            hasilSoal = this.generateMockEssay(topikMateri);
        } else if (kategori === 'susun-kata') {
            hasilSoal = this.generateMockSusunKata(topikMateri);
        }

        localStorage.setItem(`active_quiz_${kategori}`, JSON.stringify({
            topik: topikMateri,
            waktuDibuat: new Date().toISOString(),
            soal: hasilSoal
        }));

        return hasilSoal;
    },

    generateMockPilihanGanda(topik) {
        return [
            {
                id: 1,
                pertanyaan: `Apa komponen utama yang dibahas dalam materi ${topik}?`,
                opsi: ["A. Protokol Jaringan", "B. Kabel UTP", "C. Switch & Router", "D. Semua Benar"],
                jawabanBenar: "D. Semua Benar"
            },
            {
                id: 2,
                pertanyaan: `Manakah perangkat yang berfungsi meneruskan paket data pada layer network?`,
                opsi: ["A. Hub", "B. Router", "C. Repeater", "D. NIC"],
                jawabanBenar: "B. Router"
            }
        ];
    },

    generateMockEssay(topik) {
        return [
            {
                id: 1,
                pertanyaan: `Jelaskan secara singkat fungsi dan cara kerja dari ${topik} dalam sistem jaringan komputer!`,
                kunciJawaban: "Siswa harus menjelaskan konsep dasar, fungsi utama, serta implementasi nyatanya."
            },
            {
                id: 2,
                pertanyaan: `Sebutkan analisis kendala yang sering terjadi beserta solusinya terkait ${topik}!`,
                kunciJawaban: "Siswa memberikan contoh troubleshooting yang logis."
            }
        ];
    },

    generateMockSusunKata(topik) {
        return [
            {
                id: 1,
                kalimatAsli: "Konfigurasi jaringan lokal memerlukan kabel UTP dan switch",
                kataAcak: ["dan", "kabel", "Konfigurasi", "switch", "UTP", "jaringan", "lokal", "memerlukan"]
            },
            {
                id: 2,
                kalimatAsli: "Router berfungsi sebagai penghubung antar network berbeda",
                kataAcak: ["antar", "sebagai", "network", "penghubung", "berbeda", "Router", "berfungsi"]
            }
        ];
    }
};

function setupQuizTabs() {
    const containerTab = document.getElementById('quiz-tab-container');
    if (!containerTab) return;

    containerTab.innerHTML = `
        <div class="flex justify-center gap-4 mb-6 border-b border-slate-200 pb-3">
            <button onclick="switchQuizCategory('pilihan-ganda')" id="tab-btn-pg" class="px-4 py-2 bg-blue-600 text-white font-bold text-xs rounded-xl shadow-sm transition-all">
                <i class="fa-solid fa-list-check mr-1.5"></i> Pilihan Ganda (Kiri)
            </button>
            <button onclick="switchQuizCategory('essay')" id="tab-btn-essay" class="px-4 py-2 bg-slate-100 text-slate-600 font-bold text-xs rounded-xl hover:bg-slate-200 transition-all">
                <i class="fa-solid fa-pen-to-square mr-1.5"></i> Essay (Tengah)
            </button>
            <button onclick="switchQuizCategory('susun-kata')" id="tab-btn-susun" class="px-4 py-2 bg-slate-100 text-slate-600 font-bold text-xs rounded-xl hover:bg-slate-200 transition-all">
                <i class="fa-solid fa-puzzle-piece mr-1.5"></i> Susun Kata (Kanan)
            </button>
        </div>
        <div id="quiz-content-area" class="p-4 bg-slate-50 rounded-2xl border border-slate-200 min-h-[200px]">
        </div>
    `;
}

async function switchQuizCategory(kategori) {
    document.querySelectorAll('[id^="tab-btn-"]').forEach(btn => {
        btn.className = "px-4 py-2 bg-slate-100 text-slate-600 font-bold text-xs rounded-xl hover:bg-slate-200 transition-all";
    });

    let activeBtnId = 'tab-btn-pg';
    if (kategori === 'essay') activeBtnId = 'tab-btn-essay';
    if (kategori === 'susun-kata') activeBtnId = 'tab-btn-susun';

    const selectedBtn = document.getElementById(activeBtnId);
    if (selectedBtn) {
        selectedBtn.className = "px-4 py-2 bg-blue-600 text-white font-bold text-xs rounded-xl shadow-sm transition-all";
    }

    const area = document.getElementById('quiz-content-area');
    if (!area) return;

    area.innerHTML = `<p class="text-xs text-slate-400 text-center py-8">Memuat soal AI untuk kategori ${kategori}...</p>`;

    let dataSoal = null;
    try {
        const rawData = localStorage.getItem(`active_quiz_${kategori}`);
        if (rawData) dataSoal = JSON.parse(rawData);
    } catch (e) {
        dataSoal = null;
    }

    if (!dataSoal || !dataSoal.soal) {
        const generated = await QuizGenerator.generateSoal(kategori, "Jaringan Komputer");
        dataSoal = { soal: generated };
    }

    renderSoalToUI(kategori, dataSoal.soal);
}

function renderSoalToUI(kategori, listSoal) {
    const area = document.getElementById('quiz-content-area');
    if (!area) return;

    if (kategori === 'pilihan-ganda') {
        area.innerHTML = listSoal.map((item, idx) => `
            <div class="mb-4 p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                <p class="font-bold text-slate-800 text-xs mb-2">${idx + 1}. ${item.pertanyaan}</p>
                <div class="space-y-1.5 pl-2">
                    ${item.opsi.map(opt => `<label class="block text-xs text-slate-600"><input type="radio" name="pg_${item.id}" class="mr-2"> ${opt}</label>`).join('')}
                </div>
            </div>
        `).join('');
    } else if (kategori === 'essay') {
        area.innerHTML = listSoal.map((item, idx) => `
            <div class="mb-4 p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                <p class="font-bold text-slate-800 text-xs mb-2">${idx + 1}. ${item.pertanyaan}</p>
                <textarea rows="3" class="w-full p-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20" placeholder="Tulis jawaban essay di sini..."></textarea>
            </div>
        `).join('');
    } else if (kategori === 'susun-kata') {
        area.innerHTML = listSoal.map((item, idx) => `
            <div class="mb-4 p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                <p class="font-bold text-slate-800 text-xs mb-2">${idx + 1}. Susun kata-kata acak berikut menjadi kalimat yang benar:</p>
                <div class="flex flex-wrap gap-2 mb-3">
                    ${item.kataAcak.map(kata => `<span class="px-3 py-1 bg-blue-50 text-blue-700 font-bold text-xs rounded-lg border border-blue-200 cursor-pointer">${kata}</span>`).join('')}
                </div>
                <div class="p-2 bg-slate-50 border border-dashed border-slate-300 rounded-lg text-xs text-slate-400 min-h-[35px]">
                    Tempat jawaban disusun...
                </div>
            </div>
        `).join('');
    }
}