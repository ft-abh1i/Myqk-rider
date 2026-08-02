export const firebaseConfig = {
  apiKey: "AIzaSyAdE40-NJlErzD-w1y7TaIKMI_0wEXSOsg",
  authDomain: "buyqk-app.firebaseapp.com",
  projectId: "buyqk-app",
  storageBucket: "buyqk-app.firebasestorage.app",
  messagingSenderId: "330615637805",
  appId: "1:330615637805:web:44851732ea01d6be6335a4"
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
