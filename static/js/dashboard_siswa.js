        // Menggunakan waktu presisi lokal laptop/server secara mutlak untuk uji coba deadline & lock tugas
        function getAccurateNow() {
            return new Date();
        }

        function checkTaskBadgeStatus() {
            const dataRaw = localStorage.getItem('task_XII_TKJ_3');
            const badgeEl = document.getElementById('badge-tugas-baru');
            if (!badgeEl) return;

            if (!dataRaw) {
                badgeEl.classList.add('hidden');
                return;
            }

            const data = JSON.parse(dataRaw);
            if (data.isViewedByStudent) {
                badgeEl.classList.add('hidden');
            } else {
                badgeEl.classList.remove('hidden');
            }
        }

        function switchTab(tabName) {
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
            document.querySelectorAll('.nav-btn').forEach(btn => {
                btn.className = "nav-btn w-full flex items-center justify-between px-4 py-3 rounded-xl text-slate-500 hover:bg-slate-50 hover:text-slate-900 font-medium transition-all";
            });

            const targetTab = document.getElementById(`tab-${tabName}`);
            const targetBtn = document.getElementById(`btn-${tabName}`);

            if (targetTab) targetTab.classList.remove('hidden');
            if (targetBtn) {
                targetBtn.className = "nav-btn w-full flex items-center justify-between px-4 py-3 rounded-xl bg-blue-50 text-blue-600 font-semibold transition-all";
            }

            if (tabName === 'tugas') {
                const dataRaw = localStorage.getItem('task_XII_TKJ_3');
                if (dataRaw) {
                    const data = JSON.parse(dataRaw);
                    data.isViewedByStudent = true;
                    localStorage.setItem('task_XII_TKJ_3', JSON.stringify(data));
                }
                checkTaskBadgeStatus();
                renderLiveTaskContent();
            }
        }

        function updateTaskCounter() {
            const dataRaw = localStorage.getItem('task_XII_TKJ_3');
            const elPending = document.getElementById('count-pending-tasks');
            const elCompleted = document.getElementById('count-completed-tasks');
            if (!dataRaw) {
                if (elPending) elPending.innerText = "0";
                if (elCompleted) elCompleted.innerText = "0";
                return;
            }
            const data = JSON.parse(dataRaw);
            if (data.studentSubmitted || data.sudahMengumpulkan || data.grade !== null) {
                if (elPending) elPending.innerText = "0";
                if (elCompleted) elCompleted.innerText = "1";
            } else {
                if (elPending) elPending.innerText = "1";
                if (elCompleted) elCompleted.innerText = "0";
            }
        }

        function renderTugasTerdekat() {
            const container = document.getElementById('container-tugas-terdekat');
            if (!container) return;
            const dataRaw = localStorage.getItem('task_XII_TKJ_3');
            if (!dataRaw) {
                container.innerHTML = `
                    <div class="p-6 border-2 border-dashed border-slate-200 rounded-2xl text-center text-slate-400">
                        <i class="fa-solid fa-calendar-check text-2xl mb-1 text-slate-300"></i>
                        <p class="text-xs font-medium">Belum ada tugas terdekat. Semua aman!</p>
                    </div>`;
                return;
            }
            const data = JSON.parse(dataRaw);
            const judulTugas = data.judul || data.tipe || 'Tugas Pembelajaran';
            const batasWaktu = data.deadline || data.deadlineDate || '-';

            const now = getAccurateNow();
            const currentHours = String(now.getHours()).padStart(2, '0');
            const currentMinutes = String(now.getMinutes()).padStart(2, '0');
            const currentSeconds = String(now.getSeconds()).padStart(2, '0');
            const currentTimeString = `${currentHours}:${currentMinutes}`;
            const currentFullTimeString = `${currentTimeString}:${currentSeconds}`;

            let isExpired = false;
            if (batasWaktu && batasWaktu.length <= 5) {
                if (currentFullTimeString >= `${batasWaktu}:00`) isExpired = true;
            } else if (data.deadline) {
                const deadlineTime = new Date(data.deadline).getTime();
                if (!isNaN(deadlineTime) && now.getTime() > deadlineTime) isExpired = true;
            }

            if (data.studentSubmitted || data.sudahMengumpulkan) {
                container.innerHTML = `
                    <div class="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-bold">
                                <i class="fa-solid fa-circle-check text-lg"></i>
                            </div>
                            <div>
                                <span class="text-[10px] font-bold text-emerald-700 uppercase tracking-wider bg-emerald-100 px-2 py-0.5 rounded">Selesai</span>
                                <h4 class="font-bold text-slate-800 text-xs mt-0.5">Tugas Selesai Dikirim</h4>
                                <p class="text-[11px] text-slate-500">Waktu Kirim: ${data.waktuKirim || '-'}</p>
                            </div>
                        </div>
                        <button onclick="switchTab('tugas')" class="text-xs font-bold text-emerald-600 hover:underline">Buka</button>
                    </div>`;
            } else if (isExpired) {
                container.innerHTML = `
                    <div class="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-xl bg-rose-500 text-white flex items-center justify-center font-bold">
                                <i class="fa-solid fa-lock text-lg"></i>
                            </div>
                            <div>
                                <span class="text-[10px] font-bold text-rose-700 uppercase tracking-wider bg-rose-100 px-2 py-0.5 rounded">Terkunci</span>
                                <h4 class="font-bold text-slate-800 text-xs mt-0.5">${judulTugas}</h4>
                                <p class="text-[11px] text-rose-600 font-medium">Batas waktu ${batasWaktu} telah lewat.</p>
                            </div>
                        </div>
                        <button onclick="switchTab('tugas')" class="px-3 py-1.5 bg-slate-200 text-slate-600 font-bold text-xs rounded-xl">Lihat</button>
                    </div>`;
            } else {
                container.innerHTML = `
                    <div class="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center font-bold">
                                <i class="fa-solid fa-book-open text-lg"></i>
                            </div>
                            <div>
                                <span class="text-[10px] font-bold text-amber-700 uppercase tracking-wider bg-amber-100 px-2 py-0.5 rounded">Belum Dikerjakan</span>
                                <h4 class="font-bold text-slate-800 text-xs mt-0.5">${judulTugas}</h4>
                                <p class="text-[11px] text-slate-500">Batas: ${batasWaktu} WIB</p>
                            </div>
                        </div>
                        <button onclick="switchTab('tugas')" class="px-3 py-1.5 bg-amber-600 text-white font-bold text-xs rounded-xl hover:bg-amber-700">Kerjakan</button>
                    </div>`;
            }
        }

        const jadwalPelajaran = {
            "Senin": [{ start: "06:30", end: "07:30", mapel: "Upacara Bendera", guru: "Semua Guru • Lapangan" }],
            "Selasa": [{ start: "07:30", end: "09:00", mapel: "Administrasi Jaringan", guru: "Ahmad, S.T • Lab TKJ 1" }],
            "Rabu": [{ start: "07:30", end: "09:00", mapel: "Matematika Peminatan", guru: "Drs. Eko Prasetyo • Lab Komputer 1" }],
            "Kamis": [{ start: "07:30", end: "09:00", mapel: "Pemrograman Web", guru: "Ahmad Fakhri • Lab Komputer 2" }],
            "Jumat": [{ start: "07:30", end: "09:00", mapel: "Olahraga", guru: "Pak Ade, S.Pd • Lapangan" }]
        };
        const namaHariIndo = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

        function renderTodaySchedule() {
            const container = document.getElementById('today-schedule-list');
            if (!container) return;

            const now = getAccurateNow();
            let hariIni = namaHariIndo[now.getDay()];
            if (hariIni === "Minggu" || hariIni === "Sabtu") hariIni = "Senin";

            const listJadwal = jadwalPelajaran[hariIni] || [];
            const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();

            let html = '';
            listJadwal.forEach((item) => {
                const [startH, startM] = item.start.split(':').map(Number);
                const [endH, endM] = item.end.split(':').map(Number);
                const startTotalMinutes = startH * 60 + startM;
                const endTotalMinutes = endH * 60 + endM;

                let cardStyle = "border-slate-200 bg-white";
                let badgeStyle = "bg-slate-100 text-slate-600";
                let statusLabel = `<span class="text-[10px] font-bold text-slate-400">Akan Datang</span>`;

                if (currentTotalMinutes >= startTotalMinutes && currentTotalMinutes <= endTotalMinutes) {
                    cardStyle = "border-emerald-500 bg-emerald-50/50 shadow-sm";
                    badgeStyle = "bg-emerald-500 text-white animate-pulse";
                    statusLabel = `<span class="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-extrabold rounded-md animate-pulse">Sedang Berlangsung</span>`;
                } else if (currentTotalMinutes > endTotalMinutes) {
                    cardStyle = "border-slate-200 bg-slate-50 opacity-75";
                    badgeStyle = "bg-slate-200 text-slate-500";
                    statusLabel = `<span class="text-[10px] font-bold text-slate-400">Selesai</span>`;
                }

                html += `
                    <div class="flex items-center justify-between p-3.5 border rounded-xl transition-all ${cardStyle}">
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-bold px-2.5 py-1 rounded-lg ${badgeStyle}">${item.start} - ${item.end}</span>
                            ${statusLabel}
                        </div>
                        <div class="text-right">
                            <h4 class="font-bold text-slate-800 text-sm">${item.mapel}</h4>
                            <p class="text-xs text-slate-400">${item.guru}</p>
                        </div>
                    </div>`;
            });
            container.innerHTML = html;
        }

        function openModalJadwal() { 
            document.getElementById('modalJadwal').classList.remove('hidden'); 
            const now = getAccurateNow();
            let hariIni = namaHariIndo[now.getDay()];
            if (hariIni === "Minggu" || hariIni === "Sabtu") hariIni = "Senin";
            renderModalSchedule(hariIni);
        }
        
        function closeModalJadwal() { 
            document.getElementById('modalJadwal').classList.add('hidden'); 
        }

        function renderModalSchedule(day) {
            document.querySelectorAll('#day-tabs button').forEach(btn => {
                btn.className = "tab-btn px-4 py-2 text-xs font-bold rounded-xl transition-all bg-slate-100 text-slate-600 hover:bg-slate-200";
            });
            const activeBtn = document.querySelector(`#day-tabs button[data-day="${day}"]`);
            if (activeBtn) activeBtn.className = "tab-btn px-4 py-2 text-xs font-bold rounded-xl transition-all bg-blue-600 text-white";

            const container = document.getElementById('modal-schedule-list');
            const list = jadwalPelajaran[day] || [];
            if (list.length === 0) {
                container.innerHTML = `<p class="text-xs text-slate-400 text-center py-4">Tidak ada jadwal.</p>`;
                return;
            }
            container.innerHTML = list.map(i => `
                <div class="flex items-center justify-between p-3 border rounded-xl bg-slate-50">
                    <span class="text-xs font-bold bg-white px-2.5 py-1 rounded-lg shadow-sm">${i.start} - ${i.end}</span>
                    <div class="text-right">
                        <h4 class="font-bold text-slate-800 text-xs">${i.mapel}</h4>
                        <p class="text-[11px] text-slate-400">${i.guru}</p>
                    </div>
                </div>
            `).join('');
        }

        function renderLiveTaskContent() {
            const dataRaw = localStorage.getItem('task_XII_TKJ_3');
            const container = document.getElementById('container-live-tugas');
            if (!container) return;

            if (!dataRaw) {
                container.innerHTML = `
                    <div class="p-8 border-2 border-dashed border-slate-200 rounded-2xl text-center text-slate-400">
                        <i class="fa-solid fa-inbox text-3xl mb-2"></i>
                        <p class="text-xs font-medium">Belum ada tugas/catatan baru dikirimkan oleh guru.</p>
                    </div>`;
                updateTaskCounter();
                renderTugasTerdekat();
                return;
            }

            const data = JSON.parse(dataRaw);
            const deskripsiTugas = data.teks || data.deskripsi || 'Tidak ada instruksi.';
            const batasWaktuTugas = data.deadline || data.deadlineDate || '16:51';
            const tipeKonten = data.tipe || '📌 Tugas Utama';
            const judulTugas = data.judul || 'Instruksi Tugas Pembelajaran';

            let teacherImageHTML = '';
            if (data.teacherImage) {
                teacherImageHTML = `
                    <div class="mt-3">
                        <p class="text-[11px] font-semibold text-slate-500 mb-1"><i class="fa-solid fa-image mr-1"></i> Lampiran Soal dari Guru:</p>
                        <img src="${data.teacherImage}" class="max-h-64 rounded-xl border border-slate-200 object-contain shadow-sm" alt="Lampiran Guru">
                    </div>
                `;
            }

            const now = getAccurateNow();
            const currentHours = String(now.getHours()).padStart(2, '0');
            const currentMinutes = String(now.getMinutes()).padStart(2, '0');
            const currentSeconds = String(now.getSeconds()).padStart(2, '0');
            const currentTimeString = `${currentHours}:${currentMinutes}`;
            const currentFullTimeString = `${currentTimeString}:${currentSeconds}`;

            let isExpired = false;
            if (batasWaktuTugas && batasWaktuTugas.length <= 5) {
                if (currentFullTimeString >= `${batasWaktuTugas}:00`) {
                    isExpired = true;
                }
            } else if (data.deadline) {
                const deadlineTime = new Date(data.deadline).getTime();
                if (!isNaN(deadlineTime) && now.getTime() > deadlineTime) {
                    isExpired = true;
                }
            }

            let statusActionHTML = '';
            if (data.studentSubmitted || data.sudahMengumpulkan) {
                let studentImagePreview = data.studentImage ? `<div class="mt-2"><span class="text-[10px] text-slate-400">Foto Tugas Dikirim:</span><br><img src="${data.studentImage}" class="max-h-32 rounded-lg border mt-1 shadow-sm"></div>` : '';
                statusActionHTML = `
                    <div class="space-y-2 text-right">
                        <span class="inline-block text-xs text-emerald-600 font-bold bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200 shadow-sm">
                            <i class="fa-solid fa-check mr-1"></i> Tugas Berhasil Dikirim (${data.waktuKirim || '-'})
                        </span>
                        ${studentImagePreview}
                    </div>`;
            } else if (isExpired) {
                statusActionHTML = `
                    <div class="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-bold flex items-center gap-2 shadow-sm">
                        <i class="fa-solid fa-lock text-sm"></i> Waktu Habis (${batasWaktuTugas}). Tugas terkunci otomatis, tidak dapat dikirim!
                    </div>`;
            } else {
                statusActionHTML = `
                    <div class="space-y-3 w-full sm:w-auto bg-white p-4 rounded-xl border border-blue-100 shadow-sm">
                        <div class="flex flex-col gap-1">
                            <label class="text-[11px] font-bold text-slate-700"><i class="fa-solid fa-camera mr-1 text-blue-600"></i> Unggah Foto Tugas / Catatan:</label>
                            <input type="file" id="input-foto-siswa" accept="image/*" class="text-xs text-slate-500 file:mr-4 file:py-1.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer">
                        </div>
                        <button onclick="kirimTugasSiswa()" id="btn-kirim-tugas" class="w-full sm:w-auto px-5 py-2.5 bg-emerald-600 text-white font-bold text-xs rounded-xl shadow-md hover:bg-emerald-700 transition-all flex items-center justify-center gap-2">
                            <i class="fa-solid fa-paper-plane"></i> Kirim Tugas Sekarang
                        </button>
                    </div>`;
            }

            container.innerHTML = `
                <div class="p-6 rounded-2xl border-2 border-blue-200 bg-blue-50/25 space-y-4 shadow-sm">
                    <div class="flex items-center justify-between">
                        <span class="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-lg uppercase">${tipeKonten}</span>
                        <span class="text-xs text-amber-800 font-extrabold font-mono bg-amber-50 border border-amber-200 px-3 py-1 rounded-xl">
                            <i class="fa-regular fa-clock mr-1"></i> Batas: ${batasWaktuTugas} WIB
                        </span>
                    </div>
                    <h4 class="font-bold text-slate-900 text-base">${judulTugas}</h4>
                    <p class="text-xs text-slate-700 leading-relaxed bg-white p-4 rounded-xl border border-slate-200 whitespace-pre-line">${deskripsiTugas}</p>
                    ${teacherImageHTML}
                    <div class="pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between border-t border-blue-100 gap-3">
                        <span class="text-xs font-bold ${data.studentSubmitted || data.sudahMengumpulkan ? 'text-emerald-600' : (isExpired ? 'text-rose-600' : 'text-amber-600')}">
                            Status: ${data.studentSubmitted || data.sudahMengumpulkan ? 'Sudah Dikirim' : (isExpired ? 'Terkunci (Lewat Deadline)' : 'Belum Dikerjakan')}
                        </span>
                        ${statusActionHTML}
                    </div>
                </div>
            `;
            updateTaskCounter();
            renderTugasTerdekat();
        }

        function kirimTugasSiswa() {
            const dataRaw = localStorage.getItem('task_XII_TKJ_3');
            if (!dataRaw) return;
            const data = JSON.parse(dataRaw);
            
            const now = getAccurateNow();
            const currentHours = String(now.getHours()).padStart(2, '0');
            const currentMinutes = String(now.getMinutes()).padStart(2, '0');
            const currentSeconds = String(now.getSeconds()).padStart(2, '0');
            const currentTimeString = `${currentHours}:${currentMinutes}`;
            const currentFullTimeString = `${currentTimeString}:${currentSeconds}`;
            const batasWaktuTugas = data.deadline || data.deadlineDate || '16:51';

            if (batasWaktuTugas.length <= 5 && currentFullTimeString >= `${batasWaktuTugas}:00`) {
                alert('Gagal! Batas waktu pengumpulan ("' + batasWaktuTugas + ' WIB") sudah lewat. Tugas otomatis terkunci.');
                renderLiveTaskContent();
                return;
            }

            const inputFile = document.getElementById('input-foto-siswa');
            if (inputFile && inputFile.files && inputFile.files[0]) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    simpanDataTugasFinal(data, e.target.result, now);
                };
                reader.readAsDataURL(inputFile.files[0]);
            } else {
                simpanDataTugasFinal(data, null, now);
            }
        }

        function simpanDataTugasFinal(data, imageBase64, nowObj) {
            const jamDetail = String(nowObj.getHours()).padStart(2, '0') + ':' + 
                              String(nowObj.getMinutes()).padStart(2, '0') + ':' + 
                              String(nowObj.getSeconds()).padStart(2, '0') + ' WIB';

            data.studentSubmitted = true;
            data.sudahMengumpulkan = true;
            data.waktuKirim = jamDetail; 
            
            if (imageBase64) {
                data.studentImage = imageBase64;
            }
            
            localStorage.setItem('task_XII_TKJ_3', JSON.stringify(data));
            alert('Tugas berhasil dikirim pada pukul ' + jamDetail + '!');
            
            renderLiveTaskContent();
            updateTaskCounter();
            renderTugasTerdekat();
        }

        function updateHeaderClock() {
            const now = getAccurateNow();
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const seconds = String(now.getSeconds()).padStart(2, '0');
            const clockEl = document.getElementById('header-realtime-clock');
            if (clockEl) clockEl.innerText = `${hours}:${minutes}:${seconds} WIB`;

            const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
            const dateEl = document.getElementById('header-realtime-date');
            if (dateEl) dateEl.innerText = now.toLocaleDateString('id-ID', options);

            renderTodaySchedule();
            checkTaskBadgeStatus();
            
            const activeTabTugas = document.getElementById('tab-tugas');
            if (activeTabTugas && !activeTabTugas.classList.contains('hidden')) {
                renderLiveTaskContent();
            }
        }

        document.addEventListener('DOMContentLoaded', () => {
            updateHeaderClock();
            updateTaskCounter();
            renderTugasTerdekat();
            checkTaskBadgeStatus();
            setInterval(updateHeaderClock, 1000);
        });
    