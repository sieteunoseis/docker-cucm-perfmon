// Helper file to store the SSO session data and return it when needed

var ssoArr = [];

module.exports = {
  getSSOArray: function () {
    return ssoArr;
  },
  updateSSO: (server, updatedData) => {
    const ssoIndex = ssoArr.findIndex((element) => element.name === server);
    if (ssoIndex !== -1) {
      ssoArr[ssoIndex] = { ...ssoArr[ssoIndex], ...updatedData };
    } else {
      ssoArr.push({ name: server, ...updatedData });
    }
    return ssoArr;
  }
};
