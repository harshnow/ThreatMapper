package handler

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"

	"github.com/deepfence/ThreatMapper/deepfence_server/model"
	"github.com/deepfence/golang_deepfence_sdk/utils/directory"
	"github.com/go-chi/chi/v5"
	httpext "github.com/go-playground/pkg/v5/net/http"
)

func (h *Handler) GetGlobalSettings(w http.ResponseWriter, r *http.Request) {
	ctx := directory.WithGlobalContext(r.Context())
	pgClient, err := directory.PostgresClient(ctx)
	if err != nil {
		respondError(err, w)
		return
	}
	settings, err := model.GetVisibleSettings(ctx, pgClient)
	if err != nil {
		respondError(err, w)
		return
	}
	httpext.JSON(w, http.StatusOK, settings)
}

func (h *Handler) UpdateGlobalSettings(w http.ResponseWriter, r *http.Request) {
	ctx := directory.WithGlobalContext(r.Context())
	pgClient, err := directory.PostgresClient(ctx)
	if err != nil {
		respondError(err, w)
		return
	}
	settingId, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		respondError(&BadDecoding{err}, w)
		return
	}
	defer r.Body.Close()
	var req model.SettingUpdateRequest
	err = httpext.DecodeJSON(r, httpext.NoQueryParams, MaxPostRequestSize, &req)
	if err != nil {
		respondError(err, w)
		return
	}
	req.ID = settingId
	err = h.Validator.Struct(req)
	if err != nil {
		respondError(&ValidatorError{err}, w)
		return
	}
	currentSettings, err := model.GetSettingByKey(ctx, pgClient, req.Key)
	if err != nil {
		respondError(err, w)
		return
	}
	if req.ID != currentSettings.ID {
		respondError(&ValidatorError{
			errors.New("Key: 'SettingUpdateRequest.ID' Error:invalid")}, w)
		return
	}
	var value interface{}
	switch currentSettings.Key {
	case model.ConsoleURLSettingKey:
		consoleUrl := fmt.Sprintf("%s", req.Value)
		var parsedUrl *url.URL
		if parsedUrl, err = url.ParseRequestURI(consoleUrl); err != nil {
			respondError(&ValidatorError{
				errors.New("Key: 'SettingUpdateRequest.Value' Error:must be url")}, w)
			return
		}
		value = parsedUrl.Scheme + "://" + parsedUrl.Host
	case model.InactiveNodesDeleteScanResultsKey:
		val, ok := req.Value.(float64)
		if !ok {
			respondError(&ValidatorError{
				errors.New("Key: 'SettingUpdateRequest.Value' Error:must be integer")}, w)
			return
		}
		value = int(math.Round(val))
	}
	setting := model.Setting{
		ID:  req.ID,
		Key: req.Key,
		Value: &model.SettingValue{
			Label:       currentSettings.Value.Label,
			Value:       value,
			Description: currentSettings.Value.Description,
		},
		IsVisibleOnUi: currentSettings.IsVisibleOnUi,
	}
	err = setting.Update(ctx, pgClient)
	if err != nil {
		respondError(err, w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}