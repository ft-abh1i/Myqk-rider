export const firebaseConfig = {
  apiKey: "AIzaSyDbNDNI1a69VDZmLo7Se6LNGPLD6A8_MmE",
  authDomain: "buyqk-rider.firebaseapp.com",
  projectId: "buyqk-rider",
  storageBucket: "buyqk-rider.firebasestorage.app",
  messagingSenderId: "61147606971",
  appId: "1:61147606971:web:d69dd4fcf5c0a0fea01e9e"
};

const loginArtworkStyles = document.createElement("style");
loginArtworkStyles.dataset.source = "myqk-login-artwork";
loginArtworkStyles.textContent = `
#login-screen.auth-screen {
  justify-content: flex-end;
  gap: 0;
  padding: 0 24px calc(22px + env(safe-area-inset-bottom));
  background-color: #101010;
  background-image: url("./assets/login-bg.png");
  background-repeat: no-repeat;
  background-position: top center;
  background-size: 100% auto;
}
#login-screen .auth-art { display: none; }
#login-screen .auth-copy {
  width: 100%;
  margin: 0 0 16px;
  color: #ffffff;
}
#login-screen .eyebrow { color: #f8cb46; }
#login-screen .auth-copy h1 {
  color: #ffffff;
  font-size: clamp(28px, 7.4vw, 34px);
  line-height: 1.04;
  letter-spacing: -1.4px;
}
#login-screen .auth-copy > p:last-child {
  margin-top: 10px;
  color: #cbd5e1;
  font-size: 12px;
  line-height: 1.45;
}
#login-screen .btn-google {
  min-height: 52px;
  border-radius: 12px;
  background: #f8cb46;
  color: #071a3b;
  box-shadow: none;
}
#login-screen .btn-google:hover { background: #f5c12f; }
#login-screen .auth-note {
  margin: 9px 0 0;
  color: #9ca3af;
}
@media (max-height: 700px) {
  #login-screen.auth-screen {
    padding-left: 20px;
    padding-right: 20px;
    padding-bottom: calc(15px + env(safe-area-inset-bottom));
  }
  #login-screen .auth-copy { margin-bottom: 10px; }
  #login-screen .auth-copy h1 { font-size: 25px; }
  #login-screen .auth-copy > p:last-child { display: none; }
  #login-screen .btn-google { min-height: 48px; }
}
`;
document.head.appendChild(loginArtworkStyles);
