# Ses Gürültü Giderme Uygulaması

## Özet

Bu proje, ses dosyalarındaki istenmeyen gürültüleri (uğultu, arka plan gürültüsü vb.) azaltmak ve gerçek zamanlı olarak mikrofon girdisinden gürültü engellemek için geliştirilmiş bir web uygulamasıdır. Uygulama, bir Python (FastAPI) backend ve bir Java (Spring Boot) ile Tailwind CSS kullanan frontend client'tan oluşmaktadır.

Kullanıcılar `.wav` formatındaki ses dosyalarını yükleyebilir, çeşitli gürültü giderme parametrelerini ayarlayabilir ve işlenmiş sesi indirebilirler. Ayrıca, işlem öncesi ve sonrası sinyal ve spektrum grafikleri de sunulur. Gerçek zamanlı modülde ise, mikrofon sesi anlık olarak işlenerek temizlenmiş ses kullanıcıya geri verilir.

## Ön Gereksinimler

Uygulamayı yerel makinenizde çalıştırabilmek için aşağıdaki yazılımların kurulu olması gerekmektedir:

- **Python**: Sürüm 3.10+ (Önerilen: 3.12). Python paket yöneticisi `pip` de gereklidir.
- **Java Development Kit (JDK)**: Sürüm 21.
- **Apache Maven**: Proje, Maven Wrapper (`mvnw`) içerdiği için ayrıca bir Maven kurulumuna genellikle gerek yoktur. Wrapper, Maven'ı otomatik olarak indirip kullanacaktır.
- **Node.js ve npm**: Node.js (LTS sürümü önerilir) ve Node Paket Yöneticisi (npm). Bunlar, frontend arayüzü için Tailwind CSS dosyalarının derlenmesinde kullanılacaktır.
- **Git**: Projeyi klonlamak için gereklidir.
- **Web Tarayıcısı**: Google Chrome, Mozilla Firefox gibi modern bir web tarayıcısı.
- **Mikrofon**: Gerçek zamanlı gürültü engelleme özelliğini kullanmak için gereklidir.

## Kurulum ve Çalıştırma

Projeyi çalıştırmak için backend ve client uygulamalarının ayrı ayrı başlatılması gerekmektedir.

### 1. Projeyi Klonlama

Projeyi yerel makinenize klonlayın:

```bash
git clone https://github.com/alpeerkaraca/signals-and-systems-noise-cancelling
cd signals-and-systems-noise-cancelling
```

### 2. Backend Sunucusu (Python FastAPI)

Backend sunucusu, ses işleme ve analiz algoritmalarını barındırır.

1.  **Backend Dizinine Geçin**:
    Proje kök dizinindeyken:

    ```bash
    cd backend
    ```

2.  **(Önerilir) Sanal Ortam Oluşturma ve Aktifleştirme**:

    ```bash
    python -m venv venv
    ```

    Windows için:

    ```bash
    venv\Scripts\activate
    ```

    macOS/Linux için:

    ```bash
    source venv/bin/activate
    ```

3.  **Python Bağımlılıklarını Yükleme**:
    `backend` dizininde bulunan `requirements.txt` dosyasındaki bağımlılıkları yükleyin:

    ```bash
    pip install -r requirements.txt
    ```

    _Not: `requirements.txt` dosyasının projede güncel ve gerekli tüm kütüphaneleri (örn: `fastapi`, `uvicorn[standard]`, `numpy`, `scipy`, `librosa`, `matplotlib`) içerdiğinden emin olun._

4.  **FastAPI Sunucusunu Başlatma**:
    `backend` dizinindeyken aşağıdaki komutu çalıştırın:
    ```bash
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
    ```
    Bu komut, backend sunucusunu `http://localhost:8000` adresinde başlatacaktır. `--reload` parametresi, kod değişikliklerinde sunucunun otomatik olarak yeniden başlatılmasını sağlar.

### 3. Client Uygulaması (Java Spring Boot + Tailwind CSS)

Client uygulaması, kullanıcı arayüzünü sunar ve backend ile iletişim kurar.

1.  **Proje Kök Dizinine Gidin** (Eğer `backend` dizinindeyseniz):

    ```bash
    cd ..
    ```

2.  **Client Dizinine Geçin**:
    Proje kök dizinindeyken:

    ```bash
    cd client/noiseremover
    ```

3.  **Node.js Bağımlılıklarını Yükleme**:
    Tailwind CSS'in derlenmesi için gerekli Node.js paketlerini yükleyin:

    ```bash
    npm install
    ```

4.  **Tailwind CSS Dosyalarını Derleme**:
    Kullanıcı arayüzü için gerekli olan CSS dosyalarını oluşturun:

    ```bash
    npm run build:tailwindcss
    ```

    Bu komut, `package.json` dosyasındaki script'i çalıştırarak `src/main/resources/static/css/input.css` dosyasını işleyip `src/main/resources/static/css/output.css` dosyasını üretecektir.

5.  **Spring Boot Uygulamasını Başlatma**:
    `client/noiseremover` dizinindeyken aşağıdaki komutu çalıştırın:
    Windows için:
    ```bash
    ./mvnw.cmd spring-boot:run
    ```
    macOS/Linux için:
    ```bash
    ./mvnw spring-boot:run
    ```
    Bu komut, Spring Boot uygulamasını genellikle `http://localhost:8080` adresinde başlatacaktır.

### 4. Uygulamaya Erişim

Backend ve Client sunucuları başarıyla başlatıldıktan sonra:

- Web tarayıcınızı açın.
- Adres çubuğuna `http://localhost:8080` yazarak uygulamaya erişebilirsiniz.

Artık ses dosyalarınızı yükleyerek veya gerçek zamanlı mikrofon girişiyle gürültü giderme özelliklerini kullanabilirsiniz.

## Uygulamayı Hazır Olarak Kullanmak

Uygulamayı hazır olarak web üzerinden kullanmak için [https://noise-cancel.alpeerkaraca.site](https://noise-cancel.alpeerkaraca.site) adresine ulaşabilirsiniz.
