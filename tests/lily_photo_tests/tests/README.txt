Uji reaksi foto profil Lily. Taruh folder ini sebagai tests/ di sebelah file JS (atau di mana saja; path file diberikan lewat argumen).

  cd tests
  npm init -y && npm i jsdom canvas
  node test_suite.js ../lily_brain.js ../lily_photo_reactions.js   # 66 pengecekan
  node rig_test.js ../lily_rig.js                                  # fallback face di rig
  node smoke.js ../lily_brain.js ../lily_photo_reactions.js        # regresi lifecycle

Hasil akhir harus: "HASIL: 66 lulus, 0 gagal".
stub_analyzer.js = TEST DOUBLE ProfilePhotoAnalyzer; jangan dipasang di halaman.
