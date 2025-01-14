const IPGrabberManager = {
    ipGrabberDiv: undefined,
    enableTag: "Show IP-Address",
    disableTag: "Hide IP-Address",
    request: undefined,
    geoMappings: {
        country_name: "Country",
        region_name: "Region",
        city: "City",
        zip_code: "Zip Code"
    },

    initialize() {
        window.addEventListener("displayScrapeData", (detail) => IPGrabberManager._displayScrapeData(detail));

        let script = document.createElement('script');
        script.src = chrome.runtime.getURL('/javascript/automation/web-accessible-scripts/scrape-ips.js')
        script.onload = () => {
            script.remove();
            document.dispatchEvent(new CustomEvent('scrapeAddress'))
        };
        (document.head || document.documentElement).appendChild(script);

    },

    getFlagEmoji: countryCode=>String.fromCodePoint(...[...countryCode.toUpperCase()].map(x=>0x1f1a5+x.charCodeAt())),

    _displayScrapeData(detail) {

        // Must be chatting
        if (!ChatRegistry.isChatting()) {
            return;
        }

        let scrapeQuery = {}
        scrapeQuery[config.ipGrabToggle.getName()] = config.ipGrabToggle.getDefault();
        scrapeQuery[config.geoLocateToggle.getName()] = config.geoLocateToggle.getDefault();

        chrome.storage.sync.get(scrapeQuery, (result) => {
            sha1(detail["detail"]).then((hashedAddress) => {

                // Skip if blocked
                IPBlockingManager._receivedAddress(detail["detail"], hashedAddress, (skippedChat) => {

                    if (skippedChat) return;

                    let previousQuery = {}
                    previousQuery["PREVIOUS_HASHED_ADDRESS_LIST"] = {};

                    chrome.storage.local.get(previousQuery, (_result) => {
                        const previousHashedAddresses = _result["PREVIOUS_HASHED_ADDRESS_LIST"];
                        const seenTimes = (previousHashedAddresses[hashedAddress] == null) ? 0 : previousHashedAddresses[hashedAddress];
                        document.dispatchEvent(new CustomEvent(
                            "chatSeenTimes",
                            {
                                detail: {
                                    "uuid": ChatRegistry.getUUID(),
                                    "seenTimes": seenTimes,
                                    "ipAddress": detail["detail"]
                                }
                            }
                        ));

                        IPGrabberManager.displayScrapeData(
                            detail["detail"],
                            hashedAddress,
                            previousHashedAddresses,
                            result[config.ipGrabToggle.getName()] === "true",
                            result[config.geoLocateToggle.getName()] === "true",
                            seenTimes
                        );
                    });

                });

            });

        });


    },

    displayScrapeData(unhashedAddress, hashedAddress, previousHashedAddresses, showData, geoLocate, seenTimes) {

            Logger.DEBUG("Scraped IP Address from video chat | Hashed: <%s> Raw: <%s>", hashedAddress, unhashedAddress);

            const innerLogBox = document.getElementsByClassName("logitem")[0].parentNode;
            const logItemDiv = document.createElement("div");
            const seenBeforeDiv = document.createElement("div")
            IPGrabberManager.ipGrabberDiv = document.createElement("div");

            logItemDiv.classList.add("logitem");
            seenBeforeDiv.classList.add("logitem");
            IPGrabberManager.ipGrabberDiv.classList.add("logitem");

            const plural = seenTimes !== 1 && seenTimes !== "1" ? "s" : "";

            seenBeforeDiv.appendChild($(`<span class='statuslog'>You've seen this person ${seenTimes} time${plural} before.</span>`).get(0));
            const ipMessage = IPGrabberManager.createLogBoxMessage("IP Address: ", unhashedAddress)
            ipMessage.appendChild(ButtonManager.ipBlockButton(unhashedAddress))

            IPGrabberManager.ipGrabberDiv.appendChild(ipMessage); // Add the IP first
            if (!geoLocate) IPGrabberManager.ipGrabberDiv.appendChild(IPGrabberManager.createLogBoxMessage("Location: ", "Disabled (Enable in Settings)"))

            previousHashedAddresses[hashedAddress] = seenTimes + 1;
            chrome.storage.local.set({"PREVIOUS_HASHED_ADDRESS_LIST": previousHashedAddresses});

            IPGrabberManager.ipGrabberDiv.style.display = showData ? "" : "none";
            if (showData) ButtonManager.ipToggleButton.html(IPGrabberManager.disableTag);
            else ButtonManager.ipToggleButton.html(IPGrabberManager.enableTag);

            innerLogBox.appendChild(ButtonManager.ipToggleButton.get(0));
            innerLogBox.appendChild(IPGrabberManager.ipGrabberDiv);
            innerLogBox.append(seenBeforeDiv);

            if (geoLocate) {
                IPGrabberManager.request = new XMLHttpRequest();
                IPGrabberManager.request.open("GET", ConstantValues.geoLocationEndpoint + unhashedAddress, true);
                IPGrabberManager.request.onreadystatechange = IPGrabberManager.displayGeolocation;
                IPGrabberManager.request.send();
            }


    },

    displayGeolocation() {

        if (IPGrabberManager.request == null) return;
        if (!(IPGrabberManager.request.readyState === 4)) return;
        if (IPGrabberManager.request.status === 403) IPGrabberManager.ipGrabberDiv.appendChild(
            IPGrabberManager.createLogBoxMessage("(Geolocation unavailable, hourly limit reached)", "")
        );

        const mappingKeys = Object.keys(IPGrabberManager.geoMappings);

        if (IPGrabberManager.request.status === 200) {
            const geoData = JSON.parse(IPGrabberManager.request.responseText);
            const geoDataKeys = Object.keys(geoData);

            // Iterate through the JSON data received from the API, map the strings
            geoDataKeys.forEach(function(key) {
                const entry = geoData[key];
                if (mappingKeys.includes(key) && !((entry == null) || entry === ''))
                    IPGrabberManager.ipGrabberDiv.appendChild(
                        IPGrabberManager.createLogBoxMessage(IPGrabberManager.geoMappings[key] + ": ", entry, key + "_data")
                    );
            });

            // Hardcoded -> If there is longitude and latitude included, add that too
            if (geoDataKeys.includes("longitude") && geoDataKeys.includes("latitude")) {
                IPGrabberManager.ipGrabberDiv.appendChild(
                    IPGrabberManager.createLogBoxMessage(
                        "Longitude/Latitude: ", geoData["longitude"] + " / " + geoData["latitude"], "long_lat_data")
                );
            }

            if (geoDataKeys.includes("country_code") && geoDataKeys.includes("country_name")) {
                const countrySpan = $(
                    `<span>  <span class='flagText nceFont'>${IPGrabberManager.getFlagEmoji(geoData["country_code"])}</span></span>`
                ).get(0)
                $("#country_name_data").get(0).appendChild(countrySpan);
            }

        }

    },

    createLogBoxMessage: (label, value, elementId) => {

        // Create a new container for the entry
        let youMsgClass = document.createElement("p");
        youMsgClass.classList.add("youmsg");
        youMsgClass.id = elementId;

        // Set the field (bolded part)
        let field = document.createElement("strong");
        field.classList.add("statusItem");
        field.innerText = label + "";

        // Set the result (answer part)
        let entry = document.createElement("span")
        entry.innerHTML = value;

        // Add the status field & entry to the main entry
        youMsgClass.appendChild(field);
        youMsgClass.appendChild(entry);

        return youMsgClass;

    }
}


const IPBlockingManager = {

    LOCAL_STORAGE_ID: "IP_BLOCK_CONFIG",
    DEFAULT_STORAGE_VALUE: [],

    initialize() {
        IPBlockingMenu.initialize()
    },

    _receivedAddress(unhashedAddress, hashedAddress, callback) {

        IPBlockingManager.getStoredChromeConfig((result) => {
            result = result[IPBlockingManager.LOCAL_STORAGE_ID];
            const skipChat = result.includes(hashedAddress)

            if (skipChat) {
                Logger.INFO("Skipped blocked IP address <%s> with chat UUID <%s>", unhashedAddress, ChatRegistry.getUUID())
                VideoFilterManager.sendNSFWMessage(`Skipped the blocked IP address ${unhashedAddress}`)
                    .appendChild(ButtonManager.ipUnblockButton(unhashedAddress))
                AutoSkipManager.skipIfPossible();
            }

            callback(skipChat);

        });

    },

    getStoredChromeConfig(callback) {
        let blockQuery = {}
        blockQuery[IPBlockingManager.LOCAL_STORAGE_ID] = IPBlockingManager.DEFAULT_STORAGE_VALUE;
        chrome.storage.local.get(blockQuery, callback);
    },

    setStoredChromeConfig(newConfig) {
        if (newConfig == null) return;

        let blockQuery = {}
        blockQuery[IPBlockingManager.LOCAL_STORAGE_ID] = (newConfig || IPBlockingManager.DEFAULT_STORAGE_VALUE);

        chrome.storage.local.set(blockQuery);
    },

    unblockAddress(unhashedAddress, inChat = true) {
        const confirmUnblock = confirm(`Are you sure you want to unblock ${unhashedAddress}?`);
        if (!confirmUnblock) return false;

        IPBlockingManager.getStoredChromeConfig((result) => {
            result = result[IPBlockingManager.LOCAL_STORAGE_ID];

            if (result.includes(unhashedAddress)) {
                const index = result.indexOf(unhashedAddress);
                if (index > -1) result.splice(index, 1);

                IPBlockingManager.setStoredChromeConfig(result);

                if (inChat) {
                    Logger.INFO("Unblocked IP address <%s> in video chat", unhashedAddress)
                    VideoFilterManager.sendNSFWMessage(
                        `Unblocked the IP address ${unhashedAddress} in video chat`
                    );
                }
            } else {
                alert(`The IP address ${unhashedAddress} is not blocked in video chat!`)
            }

        });

        return true;
    },

    blockAddress(unhashedAddress) {
        const confirmBlock = confirm(`Are you sure you want to block ${unhashedAddress}?`);
        if (!confirmBlock) return;

        IPBlockingManager.getStoredChromeConfig((result) => {
            result = result[IPBlockingManager.LOCAL_STORAGE_ID];

            if (!result.includes(unhashedAddress)) {
                result.push(unhashedAddress);
                IPBlockingManager.setStoredChromeConfig(result);

                Logger.INFO("Blocked IP address <%s> in video chat", unhashedAddress)
                VideoFilterManager.sendNSFWMessage(
                    `Blocked the IP address ${unhashedAddress}${ChatRegistry.isChatting() ? " and skipped the current chat" : ""}`
                ).appendChild(ButtonManager.ipUnblockButton(unhashedAddress));
                AutoSkipManager.skipIfPossible();
            } else {
                alert(`The IP address ${unhashedAddress} is already blocked in video chat!`)
            }

        });

    }


}


const IPBlockingMenu = {

    settingsModal: undefined,
    settingsModalElementId: "modal-2",

    initialize() {
        IPBlockingMenu.settingsModal = document.createElement("div");
        $(IPBlockingMenu.settingsModal).load(getResourceURL("html/blocked.html"));
        $("html").append(IPBlockingMenu.settingsModal)
    },

    _modifyIfEmpty(size) {
        if (size > 0) return;

        $(".ipListTable").get(0).appendChild($(`
                <tr>
                    <td class="ipListNumber"></td>
                    <td>You have not blocked anyone...</td>
                    <td></td>
                </tr>
        `).get(0));

    },

    _genEmptyTable() {
        return $(`
                <table class="ipListTable">
                  <tr>
                    <th style="width: 10%;">Number</th>
                    <th>IP Address</th>
                    <th>Action</th>
                  </tr>              
                </table>`
        );
    },

    _buildEmptyTable(result, ipListTable) {
        for (let i=0; i < result.length; i++) {

            ipListTable.get(0).appendChild($(`
                <tr>
                    <td class="ipListNumber">${i + 1}.</td>
                    <td>${result[i]}</td>
                    <td><button class="ipListTableUnblockButton" value="${result[i]}">Unblock</button></td>
                </tr>
                `).get(0))
        }

    },

    _onUnblockButtonClick(event) {
        let confirmed = IPBlockingManager.unblockAddress(event.target.value, false);
        if (!confirmed) return;


        $(event.target).closest("tr").remove();

        let results = $(".ipListTable").find(".ipListNumber");

        results.each((item) => {
            results.get(item).innerHTML = `${item + 1}.`
        });

        Logger.INFO("Unblocked IP address <%s> in video chat", event.target.value)
        IPBlockingMenu._modifyIfEmpty(document.getElementsByClassName("ipListNumber").length);
    },

    loadMenu(noChange) {

        if (noChange) return;
        settingsManager.disable();
        IPBlockingMenu.enable();

        IPBlockingManager.getStoredChromeConfig((result) => {
            result = result[IPBlockingManager.LOCAL_STORAGE_ID];
            const ipListTable = IPBlockingMenu._genEmptyTable();
            IPBlockingMenu._buildEmptyTable(result, ipListTable);
            $("#blockedListDiv").get(0).innerHTML = $('<div>').append(ipListTable).html();
            $(".ipListTableUnblockButton").on(
                "click", (event) => IPBlockingMenu._onUnblockButtonClick(event)
            );
            IPBlockingMenu._modifyIfEmpty(result.length);

        });
    },

    enable() {
        MicroModal.show(IPBlockingMenu.settingsModalElementId)
    },

    disable() {
        MicroModal.hide(IPBlockingMenu.settingsModalElementId)

    },

}


