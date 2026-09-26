window.renderPersonelTable=function () {
    const tbody = document.querySelector('#tablePersonel tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    data.personel.forEach((item, index) => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td><input type="checkbox" class="row-select"></td>
            <td>${item.name || '-'}</td>
            <td>${item.code || '-'}</td>
            <td>
                <button class="edit-btn" onclick="if(validateAdminAction()) openPersonelModal('edit', ${index})">Düzenle</button>
                <button class="delete-btn" onclick="if(validateAdminAction()) deletePersonel(${index})">Sil</button>
            </td>
        `;
    });
}

window.deletePersonel=function (index) {
    data.personel.splice(index, 1);
    saveData(data);
    renderPersonelTable();
}

window.getRandomCode=function () {
    // Varsa mevcut fonksiyon, yoksa basit bir random (ekstra eklemedim, mevcut kodda varsa kullan)
    return Math.random().toString(36).substring(2, 7); // Örnek basit kod üretimi
}