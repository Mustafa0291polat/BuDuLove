# 🌍 BuDuVerse — 7/24 Kalıcı ve Sabit Linkli Yapma Rehberi

Şu an kullandığınız `trycloudflare.com` bağlantısı **bilgisayarınız açık olduğu sürece** ücretsiz ve sınırsız çalışır; ancak bilgisayarı kapattığınızda kapanır ve tekrar açtığınızda link değişir.

Bilgisayarınız kapalıyken bile sevgilinizle **7/24 kesintisiz ve hep aynı sabit linkle** kullanmak için aşağıdaki **2 ücretsiz yöntemden** birini seçebilirsiniz:

---

## 🚀 YÖNTEM 1: Bilgisayar Kapalıyken Bile 7/24 Çalışsın (Render.com - Ücretsiz Bulut Sunucu)

Bu yöntemle uygulamanız internetteki ücretsiz bir sunucuya yüklenir. Bilgisayarınız tamamen kapalı olsa bile 7/24 çalışır ve linkiniz asla değişmez (Örn: `https://buduverse-askimiz.onrender.com`).

1. **GitHub'a Yükleyin:**
   - [github.com](https://github.com) üzerinde ücretsiz hesabınızla yeni bir **Private (Gizli)** repository oluşturun (Örn: `budulove-app`).
   - Masaüstündeki `BuDuLove` klasörünü (`node_modules` hariç) bu repository'ye yükleyin.
2. **Render.com'a Bağlayın:**
   - [render.com](https://render.com) adresine「GitHub ile Giriş Yap」diyerek girin.
   - **New +** -> **Web Service** seçeneğine tıklayın ve `budulove-app` projenizi seçin.
   - Ayarlar klasör içindeki `render.yaml` sayesinde otomatik tanınır (`Build Command: npm install`, `Start Command: node server.js`, `Free Plan`).
   - **Deploy Web Service** butonuna basın.
3. **Sabit iPhone Linkiniz Hazır!**
   - 2 dakika içinde size `https://buduverse-askimiz.onrender.com` gibi **kalıcı ve sabit bir HTTPS adresi** verilir.
   - Bu adresi iki iPhone'da da Safari'de açıp **"Paylaş -> Ana Ekrana Ekle"** yaptığınızda, artık bilgisayarınıza hiç ihtiyaç duymadan 7/24 çalışır!

---

## 💻 YÖNTEM 2: Kendi Bilgisayarınızdan Ama Sabit (Değişmeyen) Linkle Çalışsın

Eğer verileriniz sadece kendi bilgisayarınızda kalsın ama **link her açılışta değişmesin** istiyorsanız:
- Ücretsiz bir **ngrok** ([ngrok.com](https://ngrok.com)) hesabı açtığınızda size **1 adet kalıcı ücretsiz sabit domain** (`https://sabit-isminiz.ngrok-free.app`) verir.
- Böylece bilgisayarınızı her açtığınızda aynı sabit link üzerinden iPhone'larınız otomatik bağlanır.
