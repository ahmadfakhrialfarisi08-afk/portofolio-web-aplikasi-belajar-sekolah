(function () {
  const form = document.querySelector('form');
  const overlay = document.getElementById('otpOverlay');
  const modal = document.getElementById('otpModal');
  const boxes = Array.from(document.querySelectorAll('.otp-box'));
  const verifyBtn = document.getElementById('otpVerifyBtn');
  const resendBtn = document.getElementById('otpResendBtn');
  const closeX = document.getElementById('otpCloseX');
  const successCloseBtn = document.getElementById('otpSuccessCloseBtn');
  const emailInput = document.getElementById('email');
  const otpTargetEmail = document.getElementById('otpTargetEmail');

  const DEMO_OTP = '1234'; // TODO: ganti dengan verifikasi OTP asli dari backend

  function updateVerifyBtnState() {
    const filled = boxes.every(b => b.value.trim().length === 1);
    verifyBtn.disabled = !filled;
  }

  function resetOtpBoxes() {
    boxes.forEach(b => {
      b.value = '';
      b.classList.remove('filled', 'otp-error');
    });
    updateVerifyBtnState();
    boxes[0].focus();
  }

  function openModal() {
    modal.classList.remove('is-success');
    resetOtpBoxes();
    otpTargetEmail.textContent = emailInput.value.trim() || 'email Anda';
    overlay.classList.add('show');
  }

  function closeModal() {
    overlay.classList.remove('show');
  }

  // Buka modal OTP saat form disubmit (demo: belum kirim ke server)
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      openModal();
    });
  }

  // Navigasi antar kotak OTP
  boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      box.value = box.value.replace(/[^0-9]/g, '').slice(0, 1);
      box.classList.toggle('filled', box.value.length === 1);
      box.classList.remove('otp-error');
      if (box.value && i < boxes.length - 1) {
        boxes[i + 1].focus();
      }
      updateVerifyBtnState();
    });

    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && i > 0) {
        boxes[i - 1].focus();
      }
    });

    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData.getData('text') || '').replace(/[^0-9]/g, '').slice(0, boxes.length);
      pasted.split('').forEach((ch, idx) => {
        if (boxes[idx]) {
          boxes[idx].value = ch;
          boxes[idx].classList.add('filled');
        }
      });
      if (boxes[pasted.length]) boxes[pasted.length].focus();
      updateVerifyBtnState();
    });
  });

  verifyBtn.addEventListener('click', function () {
    const entered = boxes.map(b => b.value).join('');
    if (entered === DEMO_OTP) {
      modal.classList.add('is-success');
    } else {
      boxes.forEach(b => b.classList.add('otp-error'));
      setTimeout(() => boxes.forEach(b => b.classList.remove('otp-error')), 400);
    }
  });

  resendBtn.addEventListener('click', function () {
    resendBtn.disabled = true;
    const original = resendBtn.textContent;
    let sisa = 15;
    resendBtn.textContent = `Kirim ulang (${sisa}s)`;
    const timer = setInterval(() => {
      sisa -= 1;
      if (sisa <= 0) {
        clearInterval(timer);
        resendBtn.disabled = false;
        resendBtn.textContent = original;
      } else {
        resendBtn.textContent = `Kirim ulang (${sisa}s)`;
      }
    }, 1000);
  });

  closeX.addEventListener('click', closeModal);
  successCloseBtn.addEventListener('click', function () {
    window.location.href = LUPA_PASSWORD_LOGIN_URL;
  });
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeModal();
  });
})();
