// ==========================================
// 1. DATA GURU & FITUR FILTER KELAS
// ==========================================
const daftarGuru = [
    { 
        nama: "Ahmad, S.T", 
        mataPelajaran: "Guru Produktif TKJ", 
        kelas: "XII", 
        jurusan: "TKJ / TAV",
        foto: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=600",
        wa: "6281234567890",
        motto: "Slicing Kabel, Slicing Masa Depan"
    },
    { 
        nama: "Rina Rahmawati, S.Pd", 
        mataPelajaran: "Guru Biologi & Pembina OSIS", 
        kelas: "XI", 
        jurusan: "Biologi",
        foto: "https://images.unsplash.com/photo-1580894732413-a70427423650?auto=format&fit=crop&q=80&w=600",
        wa: "6281234567891",
        motto: "Keep Scientific & Curiosity!"
    },
    { 
        nama: "Drs. M. Ridwan", 
        mataPelajaran: "Guru PPKn & Kesiswaan", 
        kelas: "X", 
        jurusan: "PPKn / Sejarah",
        foto: "https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&q=80&w=600",
        wa: "6281234567892",
        motto: "Disiplin Adalah Kunci Utama"
    },
    { 
        nama: "John Doe, M.Pd", 
        mataPelajaran: "Guru Bahasa Inggris", 
        kelas: "XII", 
        jurusan: "B. Inggris",
        foto: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=600",
        wa: "6281234567893",
        motto: "Speak Up Your Mind!"
    }
];

// Fungsi untuk merender tampilan kartu guru dengan desain Tailwind CSS
function tampilkanDaftarGuru(guruList) {
    const container = document.getElementById('daftar-guru');
    if (!container) return;
    
    container.innerHTML = '';

    if (guruList.length === 0) {
        container.innerHTML = `
            <div class="col-span-full p-8 text-center border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
                <i class="fa-solid fa-user-slash text-3xl mb-2"></i>
                <p class="text-xs font-medium">Tidak ada data guru untuk kelas ini.</p>
            </div>`;
        return;
    }

    guruList.forEach(guru => {
        const cardHTML = `
            <div class="group relative aspect-[3/4] rounded-2xl overflow-hidden shadow-md hover:shadow-2xl hover:-translate-y-1.5 transition-all duration-300 border border-slate-200/50">
                <img src="${guru.foto}" alt="${guru.nama}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">

                <div class="absolute top-3 left-3 z-10">
                    <span class="px-3 py-1 bg-slate-900/80 backdrop-blur-md text-white text-[10px] font-bold rounded-lg tracking-wider uppercase shadow-md border border-white/10">
                        ${guru.jurusan} • KELAS ${guru.kelas}
                    </span>
                </div>

                <div class="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/20 to-transparent opacity-80 group-hover:opacity-90 transition-opacity"></div>

                <div class="absolute bottom-3 left-3 right-3 p-3.5 bg-white/20 backdrop-blur-md rounded-xl border border-white/30 text-white shadow-lg">
                    <div class="flex items-center justify-between gap-2">
                        <div class="overflow-hidden">
                            <h4 class="font-bold text-sm text-white drop-shadow-sm truncate">${guru.nama}</h4>
                            <p class="text-[11px] text-slate-200 font-medium truncate mt-0.5">${guru.mataPelajaran}</p>
                        </div>
                        <a href="https://wa.me/${guru.wa}" target="_blank" class="flex-shrink-0 w-9 h-9 rounded-lg bg-emerald-500/90 text-white flex items-center justify-center hover:bg-emerald-600 hover:scale-110 active:scale-95 transition-all shadow-md border border-emerald-400/30" title="Chat WhatsApp Guru">
                            <i class="fa-brands fa-whatsapp text-lg"></i>
                        </a>
                    </div>
                    <div class="mt-2 pt-2 border-t border-white/20 flex items-center justify-between text-[10px] text-slate-200">
                        <span class="italic truncate">"${guru.motto}"</span>
                    </div>
                </div>
            </div>`;
        container.innerHTML += cardHTML;
    });
}

// Fungsi untuk mengisi Dropdown Filter Kelas
function buatFilterKelas() {
    const filterSelect = document.getElementById('filter-kelas');
    if (!filterSelect) return;

    const kelasSet = new Set(daftarGuru.map(g => g.kelas));

    filterSelect.innerHTML = `<option value="">Semua Kelas</option>`;

    kelasSet.forEach(kelas => {
        const option = document.createElement('option');
        option.value = kelas;
        option.textContent = `Kelas ${kelas}`;
        filterSelect.appendChild(option);
    });

    filterSelect.addEventListener('change', () => {
        const selectedKelas = filterSelect.value;
        const filteredGuru = selectedKelas
            ? daftarGuru.filter(g => g.kelas === selectedKelas)
            : daftarGuru;
        tampilkanDaftarGuru(filteredGuru);
    });
}


// ==========================================
// 2. LOGIKA REALTIME KONTROL TUGAS SISWA
// ==========================================

/**
 * Dipanggil saat Guru menekan tombol "Kirim Tugas" di Dashboard Guru
 * @param {string} tipeTugas - Contoh: "Tugas Praktikum" / "Catatan Materi"
 * @param {string} deskripsi - Instruksi tugas dari guru
 * @param {boolean} adaVN - Apakah melampirkan Voice Note (true/false)
 */
function kirimTugasKeSiswa(tipeTugas, deskripsi, adaVN = false) {
    const dataTugas = {
        tipe: tipeTugas || "Tugas Utama",
        teks: deskripsi || "Kerjakan soal praktikum jaringan komputer halaman 42.",
        hasVN: adaVN,
        readByStudent: false,     // Flag titik merah di dashboard siswa
        studentSubmitted: false,  // Flag apakah siswa sudah menekan kirim
        studentTime: null,
        grade: null              // Nilai tugas (null jika belum dinilai)
    };

    // Simpan ke localStorage agar dibaca oleh dashboard_siswa.js
    localStorage.setItem('task_XII_TKJ_3', JSON.stringify(dataTugas));
    alert('✅ Tugas berhasil dikirimkan ke Dashboard Siswa (XII TKJ 3)!');
}

/**
 * Dipanggil saat Guru memberikan Nilai ke Tugas Siswa
 * @param {number|string} nilai - Contoh: 95 atau "A"
 */
function beriNilaiSiswa(nilai) {
    const dataRaw = localStorage.getItem('task_XII_TKJ_3');
    if (!dataRaw) {
        alert('Belum ada tugas yang aktif atau dikirim oleh siswa!');
        return;
    }

    const data = JSON.parse(dataRaw);
    data.grade = nilai; // Masukkan nilai dari guru

    localStorage.setItem('task_XII_TKJ_3', JSON.stringify(data));
    alert(`🎉 Nilai ${nilai} berhasil disimpan dan terisi di Rapor Siswa!`);
}


// ==========================================
// 3. INISIALISASI SAAT HALAMAN DIMUAT
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    buatFilterKelas();
    tampilkanDaftarGuru(daftarGuru);
});